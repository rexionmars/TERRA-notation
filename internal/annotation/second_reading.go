package annotation

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

/*
A second reading measures how much the answers depend on who gives them, or
on when: records already answered are read again, by another person or by the
same one weeks later, without the first answers in view. It is a project of
its own, made from this one: the same GeoPackage, categories, hidden columns
and seed, no answers, and as its sample the records drawn for it. The two are
compared by reading the second from the first (exports.WriteAgreement).
*/

// SecondReading is what a second reading project is made with.
type SecondReading struct {
	Dir       string `json:"dir"`
	Name      string `json:"name"`
	Annotator string `json:"annotator"`
	Layer     string `json:"layer"`
	Size      int    `json:"size"`
}

// SecondReadingCandidates lists the records a second reading of a layer is
// drawn from: those with a category, within the current sample when the
// layer has one, since the agreement then speaks for the sample.
func (p *Project) SecondReadingCandidates(layer string) ([]int64, *Sample, error) {
	s, err := p.CurrentSample(layer)
	if err != nil {
		return nil, nil, err
	}
	in := map[int64]bool{}
	if s != nil {
		recs, err := p.SampleRecords(s.ID)
		if err != nil {
			return nil, nil, err
		}
		for _, r := range recs {
			in[r.FID] = true
		}
	}
	anns, err := p.Annotations(layer)
	if err != nil {
		return nil, nil, err
	}
	var out []int64
	for _, a := range anns {
		if a.Category != "" && (s == nil || in[a.FID]) {
			out = append(out, a.FID)
		}
	}
	return out, s, nil
}

// CreateSecondReading makes a second reading project in r.Dir and returns it
// open. This project is only read.
func (p *Project) CreateSecondReading(r SecondReading) (*Project, error) {
	r.Annotator = strings.TrimSpace(r.Annotator)
	if r.Annotator == "" {
		return nil, errors.New("give the name of who will read the records again")
	}
	if r.Size < 1 {
		return nil, errors.New("a second reading needs at least one record")
	}
	name, err := p.value("name")
	if err != nil {
		return nil, err
	}
	created, err := p.value("created_at")
	if err != nil {
		return nil, err
	}
	source, err := p.Source()
	if err != nil {
		return nil, err
	}
	settings, err := p.Settings()
	if err != nil {
		return nil, err
	}
	cands, sample, err := p.SecondReadingCandidates(r.Layer)
	if err != nil {
		return nil, err
	}
	if len(cands) == 0 {
		return nil, fmt.Errorf("layer %s has no record with a category to read again", r.Layer)
	}
	order := SeededOrder(cands, settings.Seed)
	k := min(r.Size, len(order))
	records := make([]SampleRecord, k)
	for i := range records {
		records[i] = SampleRecord{FID: order[i], Order: i + 1}
	}
	if strings.TrimSpace(r.Name) == "" {
		r.Name = name + ", second reading"
	}
	q, err := Create(r.Dir, strings.TrimSpace(r.Name), source, Settings{Annotator: r.Annotator,
		Categories: settings.Categories, Layers: settings.Layers, Seed: settings.Seed})
	if err != nil {
		return nil, err
	}
	origin := &Origin{Dir: p.dir, Name: name, CreatedAt: created, Annotator: settings.Annotator}
	if sample != nil {
		origin.SampleID = &sample.ID
	}
	d := SampleDesign{Layer: r.Layer, Kind: KindSecondReading, Size: k, Origin: origin}
	if _, err := q.keepSample(d, settings.Seed, len(cands), []Stratum{{Population: len(cands), Drawn: k}},
		records, false); err != nil {
		_ = q.Close()
		return nil, err
	}
	return q, nil
}

// SecondReadingOf is the project this one reads again, or nil when it is
// not a second reading.
func (p *Project) SecondReadingOf() (*Origin, error) {
	all, err := p.Samples()
	if err != nil {
		return nil, err
	}
	for _, s := range all {
		if s.Design.Kind == KindSecondReading && s.Design.Origin != nil {
			return s.Design.Origin, nil
		}
	}
	return nil, nil
}

// IsSecondReadingOf says whether q was made from p: its origin names p's
// name and creation time, which a copy or a move of p keeps.
func (p *Project) IsSecondReadingOf(q *Project) (bool, error) {
	o, err := q.SecondReadingOf()
	if err != nil || o == nil {
		return false, err
	}
	name, err := p.value("name")
	if err != nil {
		return false, err
	}
	created, err := p.value("created_at")
	if err != nil {
		return false, err
	}
	return o.Name == name && o.CreatedAt == created, nil
}

/*
OpenReadOnly opens a project only to read it, as a second reading is read from
the project it was made from. It is not upgraded, so a project written by
another version is refused with what to do about it.
*/
func OpenReadOnly(dir string) (*Project, error) {
	path := filepath.Join(dir, DBFile)
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro&_pragma=busy_timeout(5000)"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open the project in %s: %w", dir, err)
	}
	db.SetMaxOpenConns(1)
	p := &Project{dir: dir, db: db}
	v, err := p.value("schema_version")
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("the folder %s holds no project this application can read: %w", dir, err)
	}
	if v != strconv.Itoa(schemaVersion) {
		_ = db.Close()
		return nil, fmt.Errorf("the project in %s has schema version %s; open it once in this version of the application to upgrade it to %d",
			dir, v, schemaVersion)
	}
	return p, nil
}
