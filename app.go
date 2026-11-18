package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"terra-notation/internal/annotation"
	"terra-notation/internal/gpkg"
)

// App holds the open project and the GeoPackage it annotates. Every
// exported method is bound to the frontend.
type App struct {
	ctx context.Context

	mu      sync.Mutex
	project *annotation.Project
	source  *gpkg.File
	// sourceErr says why the GeoPackage could not be opened, when it could not.
	sourceErr string
	// layerJSON caches whole layers as GeoJSON for the map, by layer name and
	// kept columns. It is emptied whenever the source or the hidden columns
	// change.
	layerJSON map[string][]byte
}

// NewApp creates the application.
func NewApp() *App { return &App{} }

/*
startup opens the project folder given as the first argument, if there is
one (open -a "TERRA Notation" --args <folder>). The page asks for the open
project when it loads, so it starts there instead of on the start screen.
*/
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if len(os.Args) < 2 {
		return
	}
	dir := os.Args[1]
	if _, err := os.Stat(filepath.Join(dir, annotation.DBFile)); err != nil {
		return
	}
	if p, err := annotation.Open(dir); err == nil {
		if err := a.attach(p); err != nil {
			_ = p.Close()
			return
		}
		st, err := a.state()
		if err == nil {
			rememberProject(dir, st.Info.Name)
		}
	}
}

func (a *App) shutdown(context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.closeLocked()
}

func (a *App) closeLocked() {
	if a.source != nil {
		_ = a.source.Close()
		a.source = nil
	}
	if a.project != nil {
		_ = a.project.Close()
		a.project = nil
	}
	a.sourceErr = ""
}

var errNoProject = errors.New("no project is open")

// open returns the open project and source, or errNoProject.
func (a *App) open() (*annotation.Project, *gpkg.File, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.project == nil {
		return nil, nil, errNoProject
	}
	return a.project, a.source, nil
}

func (a *App) openSource() (*annotation.Project, *gpkg.File, error) {
	p, src, err := a.open()
	if err != nil {
		return nil, nil, err
	}
	if src == nil {
		a.mu.Lock()
		reason := a.sourceErr
		a.mu.Unlock()
		return nil, nil, fmt.Errorf("the GeoPackage is not open: %s", reason)
	}
	return p, src, nil
}

// ProjectState is what the interface needs to show an open project.
type ProjectState struct {
	Info   annotation.Info `json:"info"`
	Layers []gpkg.Layer    `json:"layers"`
	// SourceError says why the GeoPackage could not be opened; the project
	// can still be relinked to it.
	SourceError string `json:"source_error"`
}

func (a *App) state() (*ProjectState, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.project == nil {
		return nil, errNoProject
	}
	info, err := a.project.Info()
	if err != nil {
		return nil, err
	}
	st := &ProjectState{Info: info, SourceError: a.sourceErr, Layers: []gpkg.Layer{}}
	if a.source != nil {
		st.Layers = a.source.Layers()
	}
	return st, nil
}

// attach makes p the open project and opens its GeoPackage. A GeoPackage
// that cannot be opened leaves the project open, with the reason kept.
func (a *App) attach(p *annotation.Project) error {
	src, err := p.Source()
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.project != p {
		a.closeLocked()
	} else if a.source != nil {
		// Relinking keeps the project and replaces only the GeoPackage.
		_ = a.source.Close()
		a.source = nil
	}
	a.project = p
	a.sourceErr = ""
	a.layerJSON = nil
	if f, err := gpkg.Open(src.Path); err != nil {
		a.sourceErr = err.Error()
	} else {
		a.source = f
		fillLayerSettings(p, f)
	}
	return nil
}

/*
fillLayerSettings gives every point layer without settings the name, id and
information columns guessed from its column names, and saves them. A layer
added to the GeoPackage after the project was made would otherwise show
records as bare feature ids. Settings already chosen are left alone.
*/
func fillLayerSettings(p *annotation.Project, f *gpkg.File) {
	s, err := p.Settings()
	if err != nil {
		return
	}
	changed := false
	for _, l := range f.Layers() {
		if _, ok := s.Layers[l.Name]; !ok && l.IsPoints() && l.Problem == "" {
			s.Layers[l.Name] = guessLayerSettings(l)
			changed = true
		}
	}
	if changed {
		_ = p.UpdateSettings(s)
	}
}

// LayerSummary is a layer as the new-project screen lists it.
type LayerSummary struct {
	gpkg.Layer
	Points bool `json:"points"`
}

// InspectGeoPackage lists the layers of a GeoPackage before a project is
// made on it.
func (a *App) InspectGeoPackage(path string) ([]LayerSummary, error) {
	f, err := gpkg.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	var out []LayerSummary
	for _, l := range f.Layers() {
		out = append(out, LayerSummary{Layer: l, Points: l.IsPoints()})
	}
	return out, nil
}

// PickGeoPackage asks for a GeoPackage file. It returns "" when cancelled.
func (a *App) PickGeoPackage() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Choose the GeoPackage to annotate",
		Filters: []runtime.FileFilter{{DisplayName: "GeoPackage (*.gpkg)", Pattern: "*.gpkg"}},
	})
}

// PickFolder asks for a folder. It returns "" when cancelled.
func (a *App) PickFolder(title string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                title,
		CanCreateDirectories: true,
	})
}

// NewProject is the new-project form.
type NewProject struct {
	Dir        string `json:"dir"`
	Name       string `json:"name"`
	SourcePath string `json:"source_path"`
	Annotator  string `json:"annotator"`
}

// DefaultAnnotator is the name of the account the application runs under,
// offered as the annotator's name.
func (a *App) DefaultAnnotator() string {
	if u, err := user.Current(); err == nil {
		if u.Name != "" {
			return u.Name
		}
		return u.Username
	}
	return ""
}

// CreateProject makes a project in a folder and opens it.
func (a *App) CreateProject(req NewProject) (*ProjectState, error) {
	if strings.TrimSpace(req.Dir) == "" {
		return nil, errors.New("choose a folder for the project")
	}
	if strings.TrimSpace(req.Name) == "" {
		req.Name = filepath.Base(req.Dir)
	}
	f, err := gpkg.Open(req.SourcePath)
	if err != nil {
		return nil, err
	}
	layers := f.Layers()
	_ = f.Close()
	src, err := annotation.HashFile(req.SourcePath)
	if err != nil {
		return nil, err
	}
	settings := annotation.Settings{
		Annotator: strings.TrimSpace(req.Annotator),
		Layers:    map[string]annotation.LayerSettings{},
	}
	for _, l := range layers {
		if l.IsPoints() {
			settings.Layers[l.Name] = guessLayerSettings(l)
		}
	}
	p, err := annotation.Create(req.Dir, strings.TrimSpace(req.Name), src, settings)
	if err != nil {
		return nil, err
	}
	if err := a.attach(p); err != nil {
		_ = p.Close()
		return nil, err
	}
	rememberProject(req.Dir, req.Name)
	return a.state()
}

// OpenProject opens the project in a folder.
func (a *App) OpenProject(dir string) (*ProjectState, error) {
	p, err := annotation.Open(dir)
	if err != nil {
		return nil, err
	}
	if err := a.attach(p); err != nil {
		_ = p.Close()
		return nil, err
	}
	st, err := a.state()
	if err != nil {
		return nil, err
	}
	rememberProject(dir, st.Info.Name)
	return st, nil
}

// CurrentProject returns the open project, or an error when none is.
func (a *App) CurrentProject() (*ProjectState, error) { return a.state() }

// CloseProject closes the open project.
func (a *App) CloseProject() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.closeLocked()
}

// RelinkSource points the project at a GeoPackage in a new place. A file
// with a different hash is accepted only when acceptChanged is true.
func (a *App) RelinkSource(path string, acceptChanged bool) (*ProjectState, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	f, err := gpkg.Open(path)
	if err != nil {
		return nil, err
	}
	_ = f.Close()
	if err := p.Relink(path, acceptChanged); err != nil {
		return nil, err
	}
	if err := a.attach(p); err != nil {
		return nil, err
	}
	return a.state()
}

// UpdateSettings replaces the project's settings.
func (a *App) UpdateSettings(s annotation.Settings) (*ProjectState, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	if err := p.UpdateSettings(s); err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.layerJSON = nil
	a.mu.Unlock()
	return a.state()
}

// Reveal shows a file or folder in the Finder.
func (a *App) Reveal(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("reveal: %w", err)
	}
	return reveal(a.ctx, path)
}

// Column names CNEFE files and the TERRA layers use, in order of preference.
var (
	nameColumns = []string{"name", "nome", "dsc_estabelecimento", "nome_estabelecimento", "no_entidade", "nom_estab", "label"}
	idColumns   = []string{"cnefe_id", "cod_unico_endereco", "co_entidade", "cnes", "osm_id", "id", "codigo"}
	infoColumns = []string{"municipality", "municipio", "nm_mun", "cod_municipio", "locality", "localidade",
		"dsc_localidade", "kind", "precision", "nv_geo_coord", "uf"}
)

func guessLayerSettings(l gpkg.Layer) annotation.LayerSettings {
	have := map[string]string{}
	for _, c := range l.Columns {
		have[strings.ToLower(c.Name)] = c.Name
	}
	first := func(cands []string) string {
		for _, c := range cands {
			if n, ok := have[c]; ok {
				return n
			}
		}
		return ""
	}
	s := annotation.LayerSettings{NameColumn: first(nameColumns), IDColumn: first(idColumns)}
	for _, c := range infoColumns {
		if n, ok := have[c]; ok && len(s.InfoColumns) < 4 {
			s.InfoColumns = append(s.InfoColumns, n)
		}
	}
	return s
}
