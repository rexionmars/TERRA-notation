/*
Package annotation keeps an annotation project: one folder holding an SQLite
file with the judgements and the folder of screenshots they rest on.

A project refers to one GeoPackage by path and SHA-256. The GeoPackage is not
copied and not written; the hash is what says later whether the file the
annotations were made on is still the file at that path.

Judgements are revised, but a revision never erases one. Every save adds a row
to annotation_history, which triggers make insert-only, and the annotation row
keeps the first category ever given. A screenshot that is replaced or removed
keeps its file and its row, marked with the time it stopped being current.
*/
package annotation

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

// DBFile is the name of the project database inside the project folder.
const DBFile = "annotations.sqlite"

// ImagesDir is the folder, inside the project folder, that holds screenshots.
const ImagesDir = "images"

const schemaVersion = "1"

const schema = `
CREATE TABLE project (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE annotation (
  layer TEXT NOT NULL,
  fid INTEGER NOT NULL,
  record_id TEXT NOT NULL DEFAULT '',
  record_name TEXT NOT NULL DEFAULT '',
  lon REAL,
  lat REAL,
  category TEXT NOT NULL DEFAULT '',
  first_category TEXT NOT NULL DEFAULT '',
  reference_label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  annotator TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (layer, fid)
);
CREATE TABLE annotation_history (
  id INTEGER PRIMARY KEY,
  layer TEXT NOT NULL,
  fid INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  category TEXT NOT NULL,
  reference_label TEXT NOT NULL,
  notes TEXT NOT NULL,
  annotator TEXT NOT NULL,
  source_image_id INTEGER,
  reference_image_id INTEGER,
  saved_at TEXT NOT NULL
);
CREATE INDEX annotation_history_record ON annotation_history (layer, fid);
CREATE TRIGGER annotation_history_no_update BEFORE UPDATE ON annotation_history
BEGIN SELECT RAISE(ABORT, 'annotation_history only receives additions'); END;
CREATE TRIGGER annotation_history_no_delete BEFORE DELETE ON annotation_history
BEGIN SELECT RAISE(ABORT, 'annotation_history only receives additions'); END;
CREATE TABLE image (
  id INTEGER PRIMARY KEY,
  layer TEXT NOT NULL,
  fid INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('source', 'reference')),
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  origin TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX image_record ON image (layer, fid, side);
`

// Source is the GeoPackage a project annotates.
type Source struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

// Category is one answer to "what is at this point".
type Category struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// LayerSettings says which columns name a record and which are kept out of
// sight while annotating.
type LayerSettings struct {
	NameColumn  string   `json:"name_column"`
	IDColumn    string   `json:"id_column"`
	InfoColumns []string `json:"info_columns"`
	// HiddenColumns are not shown while annotating, so that a judgement is
	// not made knowing them (labelling blind to treatment, protocol guide
	// section 28). They are still exported.
	HiddenColumns []string `json:"hidden_columns"`
}

// Settings are the project's choices, kept in the project database.
type Settings struct {
	Annotator  string                   `json:"annotator"`
	Categories []Category               `json:"categories"`
	Layers     map[string]LayerSettings `json:"layers"`
	// Seed fixes the random order of records, so a sample read in that order
	// can be named and repeated.
	Seed int64 `json:"seed"`
}

// SourceStatus says whether the GeoPackage at the recorded path is the one
// the project was made on.
type SourceStatus string

// The source statuses.
const (
	SourceSame    SourceStatus = "same"
	SourceChanged SourceStatus = "changed"
	SourceMissing SourceStatus = "missing"
)

// Info describes an open project.
type Info struct {
	Dir          string       `json:"dir"`
	Name         string       `json:"name"`
	CreatedAt    string       `json:"created_at"`
	Source       Source       `json:"source"`
	SourceStatus SourceStatus `json:"source_status"`
	// CurrentSHA256 is the hash of the file now at Source.Path, when it
	// differs from the recorded one.
	CurrentSHA256 string   `json:"current_sha256"`
	Settings      Settings `json:"settings"`
}

// DefaultCategories are offered to a new project and can be edited in it.
// They describe what the reference imagery shows at the recorded point,
// without saying why.
func DefaultCategories() []Category {
	return []Category{
		{ID: "present", Label: "Facility at the point", Description: "the facility the layer records is visible at the point"},
		{ID: "displaced", Label: "Facility nearby, not at the point", Description: "the facility exists, but somewhere else close by"},
		{ID: "other_use", Label: "Other use at the site", Description: "the site is something else: a restaurant, a house, a shop, a church"},
		{ID: "abandoned", Label: "Abandoned or in ruins", Description: "there is a building with no sign of use"},
		{ID: "absent", Label: "Nothing built at the point", Description: "vegetation, road or empty ground"},
		{ID: "inconclusive", Label: "Cannot tell", Description: "old imagery, cloud, low resolution or no label"},
	}
}

// Project is an open annotation project.
type Project struct {
	dir string
	db  *sql.DB
}

func openDB(path string, create bool) (*sql.DB, error) {
	mode := "rw"
	if create {
		mode = "rwc"
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=" + mode + "&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One connection: a single person writes, and SQLite serialises writers
	// anyway. It also keeps every statement on the same pragmas.
	db.SetMaxOpenConns(1)
	return db, nil
}

// HashFile returns the SHA-256 and size of a file.
func HashFile(path string) (Source, error) {
	f, err := os.Open(path)
	if err != nil {
		return Source{}, fmt.Errorf("hash %s: %w", filepath.Base(path), err)
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return Source{}, fmt.Errorf("hash %s: %w", filepath.Base(path), err)
	}
	return Source{Path: path, SHA256: hex.EncodeToString(h.Sum(nil)), Bytes: n}, nil
}

func randomSeed() int64 {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UnixNano() % 1_000_000
	}
	// Six digits at most: a seed is read aloud and typed into a methods
	// section, and nothing here needs more.
	return int64(binary.BigEndian.Uint32(b[:]) % 1_000_000)
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// Create makes a project in dir, which must not already hold one.
func Create(dir, name string, source Source, settings Settings) (*Project, error) {
	if err := os.MkdirAll(filepath.Join(dir, ImagesDir), 0o755); err != nil {
		return nil, fmt.Errorf("create project folder: %w", err)
	}
	dbPath := filepath.Join(dir, DBFile)
	if _, err := os.Stat(dbPath); err == nil {
		return nil, fmt.Errorf("the folder already holds a project (%s); open it instead", DBFile)
	}
	if settings.Seed == 0 {
		settings.Seed = randomSeed()
	}
	if len(settings.Categories) == 0 {
		settings.Categories = DefaultCategories()
	}
	if settings.Layers == nil {
		settings.Layers = map[string]LayerSettings{}
	}
	if err := validateCategories(settings.Categories); err != nil {
		return nil, err
	}
	db, err := openDB(dbPath, true)
	if err != nil {
		return nil, fmt.Errorf("create project database: %w", err)
	}
	p := &Project{dir: dir, db: db}
	if err := p.init(name, source, settings); err != nil {
		_ = db.Close()
		_ = os.Remove(dbPath)
		return nil, err
	}
	return p, nil
}

func (p *Project) init(name string, source Source, settings Settings) error {
	tx, err := p.db.Begin()
	if err != nil {
		return fmt.Errorf("create project database: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(schema); err != nil {
		return fmt.Errorf("create project database: %w", err)
	}
	src, _ := json.Marshal(source)
	set, _ := json.Marshal(settings)
	for k, v := range map[string]string{
		"schema_version": schemaVersion,
		"name":           name,
		"created_at":     now(),
		"source":         string(src),
		"settings":       string(set),
	} {
		if _, err := tx.Exec(`INSERT INTO project (key, value) VALUES (?, ?)`, k, v); err != nil {
			return fmt.Errorf("create project database: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("create project database: %w", err)
	}
	return nil
}

// Open opens the project in dir.
func Open(dir string) (*Project, error) {
	dbPath := filepath.Join(dir, DBFile)
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("the folder holds no annotation project (no %s)", DBFile)
	}
	db, err := openDB(dbPath, false)
	if err != nil {
		return nil, fmt.Errorf("open project database: %w", err)
	}
	p := &Project{dir: dir, db: db}
	v, err := p.value("schema_version")
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("open project database: %w", err)
	}
	if v != schemaVersion {
		_ = db.Close()
		return nil, fmt.Errorf("the project was written with schema version %s; this version of the application reads %s", v, schemaVersion)
	}
	return p, nil
}

// Close closes the project database.
func (p *Project) Close() error { return p.db.Close() }

// Dir is the project folder.
func (p *Project) Dir() string { return p.dir }

func (p *Project) value(key string) (string, error) {
	var v string
	if err := p.db.QueryRow(`SELECT value FROM project WHERE key = ?`, key).Scan(&v); err != nil {
		return "", fmt.Errorf("read project %s: %w", key, err)
	}
	return v, nil
}

func (p *Project) setValue(key, value string) error {
	if _, err := p.db.Exec(`INSERT INTO project (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value); err != nil {
		return fmt.Errorf("write project %s: %w", key, err)
	}
	return nil
}

// Source is the recorded GeoPackage.
func (p *Project) Source() (Source, error) {
	var s Source
	v, err := p.value("source")
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal([]byte(v), &s); err != nil {
		return s, fmt.Errorf("read project source: %w", err)
	}
	return s, nil
}

// Settings are the project's current settings.
func (p *Project) Settings() (Settings, error) {
	var s Settings
	v, err := p.value("settings")
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal([]byte(v), &s); err != nil {
		return s, fmt.Errorf("read project settings: %w", err)
	}
	if s.Layers == nil {
		s.Layers = map[string]LayerSettings{}
	}
	return s, nil
}

// Info describes the project and checks the GeoPackage against its hash.
func (p *Project) Info() (Info, error) {
	info := Info{Dir: p.dir}
	var err error
	if info.Name, err = p.value("name"); err != nil {
		return info, err
	}
	if info.CreatedAt, err = p.value("created_at"); err != nil {
		return info, err
	}
	if info.Source, err = p.Source(); err != nil {
		return info, err
	}
	if info.Settings, err = p.Settings(); err != nil {
		return info, err
	}
	current, err := HashFile(info.Source.Path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		info.SourceStatus = SourceMissing
	case err != nil:
		return info, err
	case current.SHA256 != info.Source.SHA256:
		info.SourceStatus = SourceChanged
		info.CurrentSHA256 = current.SHA256
	default:
		info.SourceStatus = SourceSame
	}
	return info, nil
}

// Relink records a new path for the GeoPackage. When the file there has a
// different hash, acceptChanged must be true, and the new hash is recorded
// with the old one kept in the project table.
func (p *Project) Relink(path string, acceptChanged bool) error {
	old, err := p.Source()
	if err != nil {
		return err
	}
	cur, err := HashFile(path)
	if err != nil {
		return err
	}
	if cur.SHA256 != old.SHA256 {
		if !acceptChanged {
			return errors.New("the file has a different SHA-256 from the one the project was made on")
		}
		prev, _ := json.Marshal(old)
		if err := p.setValue("source_before_"+now(), string(prev)); err != nil {
			return err
		}
	}
	b, _ := json.Marshal(cur)
	return p.setValue("source", string(b))
}

var categoryID = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

func validateCategories(cats []Category) error {
	if len(cats) == 0 {
		return errors.New("the project needs at least one category")
	}
	seen := map[string]bool{}
	for _, c := range cats {
		if !categoryID.MatchString(c.ID) {
			return fmt.Errorf("category id %q must be lower-case letters, digits and _", c.ID)
		}
		if strings.TrimSpace(c.Label) == "" {
			return fmt.Errorf("category %s has no label", c.ID)
		}
		if seen[c.ID] {
			return fmt.Errorf("category id %s appears twice", c.ID)
		}
		seen[c.ID] = true
	}
	return nil
}

// UpdateSettings replaces the settings. A category that annotations use
// cannot be removed: their answers would stop meaning anything.
func (p *Project) UpdateSettings(s Settings) error {
	if err := validateCategories(s.Categories); err != nil {
		return err
	}
	keep := map[string]bool{}
	for _, c := range s.Categories {
		keep[c.ID] = true
	}
	rows, err := p.db.Query(`SELECT category, count(*) FROM annotation WHERE category <> '' GROUP BY category
		UNION ALL SELECT category, count(*) FROM annotation_history WHERE category <> '' GROUP BY category`)
	if err != nil {
		return fmt.Errorf("check categories in use: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return fmt.Errorf("check categories in use: %w", err)
		}
		if !keep[id] {
			return fmt.Errorf("category %s is used by %d saved answers and cannot be removed; rename its label instead", id, n)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("check categories in use: %w", err)
	}
	if s.Layers == nil {
		s.Layers = map[string]LayerSettings{}
	}
	b, _ := json.Marshal(s)
	return p.setValue("settings", string(b))
}
