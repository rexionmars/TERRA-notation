package annotation

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Snapshot is what the GeoPackage said about a record when it was annotated.
// It is kept with the annotation so the answer stays readable if the source
// file changes or moves.
type Snapshot struct {
	RecordID   string
	RecordName string
	Lon, Lat   *float64
}

// Draft is an annotation as the form sends it.
type Draft struct {
	Layer          string `json:"layer"`
	FID            int64  `json:"fid"`
	Category       string `json:"category"`
	ReferenceLabel string `json:"reference_label"`
	// ReferenceDate is the date of the imagery the reference screenshot
	// shows, as the reference map gives it: YYYY, YYYY-MM or YYYY-MM-DD,
	// ReferenceDateNotShown, or empty when it was not recorded.
	ReferenceDate string `json:"reference_date"`
	Notes         string `json:"notes"`
	// OpenedAt is when the page opened the record, in RFC 3339. It is kept
	// with the revision, so the time a judgement took can be measured.
	OpenedAt string `json:"opened_at"`
}

// ReferenceDateNotShown records that the reference map showed no date for
// its imagery, which is not the same as a date nobody wrote down.
const ReferenceDateNotShown = "not shown"

var partialDate = regexp.MustCompile(`^\d{4}(-\d{2}(-\d{2})?)?$`)

// checkReferenceDate accepts YYYY, YYYY-MM and YYYY-MM-DD dates that exist,
// ReferenceDateNotShown and the empty string.
func checkReferenceDate(d string) error {
	if d == "" || d == ReferenceDateNotShown {
		return nil
	}
	if partialDate.MatchString(d) {
		layout := map[int]string{4: "2006", 7: "2006-01", 10: "2006-01-02"}[len(d)]
		if _, err := time.Parse(layout, d); err == nil {
			return nil
		}
	}
	return fmt.Errorf("the date of the reference imagery %q is not a date written as YYYY, YYYY-MM or YYYY-MM-DD", d)
}

// openedAt reads the page's opening time; one that cannot be read, or that
// lies after the save, is not kept rather than kept wrong.
func openedAt(s string, saved time.Time) any {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil || t.After(saved) {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

// Annotation is the current answer for one record.
type Annotation struct {
	Layer          string   `json:"layer"`
	FID            int64    `json:"fid"`
	RecordID       string   `json:"record_id"`
	RecordName     string   `json:"record_name"`
	Lon            *float64 `json:"lon"`
	Lat            *float64 `json:"lat"`
	Category       string   `json:"category"`
	FirstCategory  string   `json:"first_category"`
	ReferenceLabel string   `json:"reference_label"`
	ReferenceDate  string   `json:"reference_date"`
	Notes          string   `json:"notes"`
	Annotator      string   `json:"annotator"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	Revision       int      `json:"revision"`
}

// HistoryEntry is one saved revision.
type HistoryEntry struct {
	Revision         int    `json:"revision"`
	Category         string `json:"category"`
	ReferenceLabel   string `json:"reference_label"`
	ReferenceDate    string `json:"reference_date"`
	Notes            string `json:"notes"`
	Annotator        string `json:"annotator"`
	SourceImageID    *int64 `json:"source_image_id"`
	ReferenceImageID *int64 `json:"reference_image_id"`
	// OpenedAt is when the record was opened before this save; nil for
	// revisions saved before it was recorded.
	OpenedAt *string `json:"opened_at"`
	SavedAt  string  `json:"saved_at"`
}

// Entry is everything the project holds about one feature: its annotation,
// its current screenshots and the number of revisions saved.
type Entry struct {
	Annotation     *Annotation `json:"annotation"`
	SourceImage    *Image      `json:"source_image"`
	ReferenceImage *Image      `json:"reference_image"`
	Revisions      int         `json:"revisions"`
}

// Summary is what the record list shows for one feature.
type Summary struct {
	FID               int64  `json:"fid"`
	Category          string `json:"category"`
	Saved             bool   `json:"saved"`
	HasSourceImage    bool   `json:"has_source_image"`
	HasReferenceImage bool   `json:"has_reference_image"`
}

const annotationColumns = `layer, fid, record_id, record_name, lon, lat, category, first_category,
	reference_label, reference_date, notes, annotator, created_at, updated_at, revision`

func scanAnnotation(s interface{ Scan(...any) error }) (*Annotation, error) {
	var a Annotation
	var lon, lat sql.NullFloat64
	if err := s.Scan(&a.Layer, &a.FID, &a.RecordID, &a.RecordName, &lon, &lat, &a.Category,
		&a.FirstCategory, &a.ReferenceLabel, &a.ReferenceDate, &a.Notes, &a.Annotator, &a.CreatedAt,
		&a.UpdatedAt, &a.Revision); err != nil {
		return nil, err
	}
	if lon.Valid && lat.Valid {
		a.Lon, a.Lat = &lon.Float64, &lat.Float64
	}
	return &a, nil
}

type querier interface {
	QueryRow(query string, args ...any) *sql.Row
}

func annotationOf(q querier, layer string, fid int64) (*Annotation, error) {
	a, err := scanAnnotation(q.QueryRow(`SELECT `+annotationColumns+` FROM annotation WHERE layer = ? AND fid = ?`, layer, fid))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read annotation %s/%d: %w", layer, fid, err)
	}
	return a, nil
}

// Record returns the annotation, the current screenshots and the number of
// saved revisions of one feature.
func (p *Project) Record(layer string, fid int64) (*Entry, error) {
	r := &Entry{}
	var err error
	if r.Annotation, err = annotationOf(p.db, layer, fid); err != nil {
		return nil, err
	}
	if r.SourceImage, err = p.currentImage(p.db, layer, fid, SideSource); err != nil {
		return nil, err
	}
	if r.ReferenceImage, err = p.currentImage(p.db, layer, fid, SideReference); err != nil {
		return nil, err
	}
	if err := p.db.QueryRow(`SELECT count(*) FROM annotation_history WHERE layer = ? AND fid = ?`,
		layer, fid).Scan(&r.Revisions); err != nil {
		return nil, fmt.Errorf("count revisions of %s/%d: %w", layer, fid, err)
	}
	return r, nil
}

// Save stores a draft. A draft equal to the current answer adds nothing;
// any other adds a revision to the history.
func (p *Project) Save(d Draft, snap Snapshot) (*Entry, error) {
	d.Category = strings.TrimSpace(d.Category)
	d.ReferenceLabel = strings.TrimSpace(d.ReferenceLabel)
	d.ReferenceDate = strings.TrimSpace(d.ReferenceDate)
	d.Notes = strings.TrimSpace(d.Notes)
	if err := checkReferenceDate(d.ReferenceDate); err != nil {
		return nil, err
	}
	settings, err := p.Settings()
	if err != nil {
		return nil, err
	}
	if d.Category != "" && !hasCategory(settings.Categories, d.Category) {
		return nil, fmt.Errorf("category %s is not one of the project's categories", d.Category)
	}
	tx, err := p.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("save annotation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	cur, err := annotationOf(tx, d.Layer, d.FID)
	if err != nil {
		return nil, err
	}
	unchanged := cur != nil && cur.Category == d.Category && cur.ReferenceLabel == d.ReferenceLabel &&
		cur.ReferenceDate == d.ReferenceDate && cur.Notes == d.Notes
	empty := cur == nil && d.Category == "" && d.ReferenceLabel == "" && d.ReferenceDate == "" && d.Notes == ""
	if unchanged || empty {
		// The database has one connection, which the transaction holds.
		_ = tx.Rollback()
		return p.Record(d.Layer, d.FID)
	}
	savedAt := time.Now().UTC()
	t := savedAt.Format(time.RFC3339)
	first := d.Category
	revision := 1
	created := t
	if cur != nil {
		revision = cur.Revision + 1
		created = cur.CreatedAt
		if cur.FirstCategory != "" {
			first = cur.FirstCategory
		}
	}
	if _, err := tx.Exec(`INSERT INTO annotation (`+annotationColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (layer, fid) DO UPDATE SET
		  record_id = excluded.record_id, record_name = excluded.record_name,
		  lon = excluded.lon, lat = excluded.lat, category = excluded.category,
		  first_category = excluded.first_category, reference_label = excluded.reference_label,
		  reference_date = excluded.reference_date, notes = excluded.notes,
		  annotator = excluded.annotator, updated_at = excluded.updated_at,
		  revision = excluded.revision`,
		d.Layer, d.FID, snap.RecordID, snap.RecordName, snap.Lon, snap.Lat, d.Category, first,
		d.ReferenceLabel, d.ReferenceDate, d.Notes, settings.Annotator, created, t, revision); err != nil {
		return nil, fmt.Errorf("save annotation: %w", err)
	}
	src, err := p.currentImage(tx, d.Layer, d.FID, SideSource)
	if err != nil {
		return nil, err
	}
	ref, err := p.currentImage(tx, d.Layer, d.FID, SideReference)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO annotation_history
		(layer, fid, revision, category, reference_label, reference_date, notes, annotator,
		 source_image_id, reference_image_id, opened_at, saved_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.Layer, d.FID, revision, d.Category, d.ReferenceLabel, d.ReferenceDate, d.Notes, settings.Annotator,
		imageID(src), imageID(ref), openedAt(d.OpenedAt, savedAt), t); err != nil {
		return nil, fmt.Errorf("save annotation history: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("save annotation: %w", err)
	}
	return p.Record(d.Layer, d.FID)
}

func hasCategory(cats []Category, id string) bool {
	for _, c := range cats {
		if c.ID == id {
			return true
		}
	}
	return false
}

func imageID(img *Image) *int64 {
	if img == nil {
		return nil
	}
	return &img.ID
}

// History lists the saved revisions of one record, oldest first.
func (p *Project) History(layer string, fid int64) ([]HistoryEntry, error) {
	rows, err := p.db.Query(`SELECT revision, category, reference_label, reference_date, notes, annotator,
		source_image_id, reference_image_id, opened_at, saved_at
		FROM annotation_history WHERE layer = ? AND fid = ? ORDER BY id`, layer, fid)
	if err != nil {
		return nil, fmt.Errorf("read history of %s/%d: %w", layer, fid, err)
	}
	defer func() { _ = rows.Close() }()
	out := []HistoryEntry{}
	for rows.Next() {
		var h HistoryEntry
		if err := rows.Scan(&h.Revision, &h.Category, &h.ReferenceLabel, &h.ReferenceDate, &h.Notes,
			&h.Annotator, &h.SourceImageID, &h.ReferenceImageID, &h.OpenedAt, &h.SavedAt); err != nil {
			return nil, fmt.Errorf("read history of %s/%d: %w", layer, fid, err)
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// Summaries lists every feature of a layer that has an annotation or a
// current screenshot.
func (p *Project) Summaries(layer string) ([]Summary, error) {
	byFID := map[int64]*Summary{}
	order := []int64{}
	get := func(fid int64) *Summary {
		s, ok := byFID[fid]
		if !ok {
			s = &Summary{FID: fid}
			byFID[fid] = s
			order = append(order, fid)
		}
		return s
	}
	rows, err := p.db.Query(`SELECT fid, category FROM annotation WHERE layer = ?`, layer)
	if err != nil {
		return nil, fmt.Errorf("read annotations of %s: %w", layer, err)
	}
	for rows.Next() {
		var fid int64
		var cat string
		if err := rows.Scan(&fid, &cat); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("read annotations of %s: %w", layer, err)
		}
		s := get(fid)
		s.Saved, s.Category = true, cat
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read annotations of %s: %w", layer, err)
	}
	rows, err = p.db.Query(`SELECT DISTINCT fid, side FROM image WHERE layer = ? AND removed_at IS NULL`, layer)
	if err != nil {
		return nil, fmt.Errorf("read screenshots of %s: %w", layer, err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var fid int64
		var side string
		if err := rows.Scan(&fid, &side); err != nil {
			return nil, fmt.Errorf("read screenshots of %s: %w", layer, err)
		}
		s := get(fid)
		if Side(side) == SideSource {
			s.HasSourceImage = true
		} else {
			s.HasReferenceImage = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read screenshots of %s: %w", layer, err)
	}
	out := make([]Summary, len(order))
	for i, fid := range order {
		out[i] = *byFID[fid]
	}
	return out, nil
}

// Annotations lists the current annotations of a layer in fid order.
func (p *Project) Annotations(layer string) ([]Annotation, error) {
	rows, err := p.db.Query(`SELECT `+annotationColumns+` FROM annotation WHERE layer = ? ORDER BY fid`, layer)
	if err != nil {
		return nil, fmt.Errorf("read annotations of %s: %w", layer, err)
	}
	defer func() { _ = rows.Close() }()
	var out []Annotation
	for rows.Next() {
		a, err := scanAnnotation(rows)
		if err != nil {
			return nil, fmt.Errorf("read annotations of %s: %w", layer, err)
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// AnnotatedLayers lists the layers with at least one annotation or screenshot.
func (p *Project) AnnotatedLayers() ([]string, error) {
	rows, err := p.db.Query(`SELECT layer FROM annotation UNION SELECT layer FROM image WHERE removed_at IS NULL ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("list annotated layers: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var l string
		if err := rows.Scan(&l); err != nil {
			return nil, fmt.Errorf("list annotated layers: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// HistoryRow is one revision with the record it belongs to, for export.
type HistoryRow struct {
	FID int64
	HistoryEntry
}

// LayerHistory lists every saved revision of a layer, in the order saved.
func (p *Project) LayerHistory(layer string) ([]HistoryRow, error) {
	rows, err := p.db.Query(`SELECT fid, revision, category, reference_label, reference_date, notes, annotator,
		source_image_id, reference_image_id, opened_at, saved_at
		FROM annotation_history WHERE layer = ? ORDER BY id`, layer)
	if err != nil {
		return nil, fmt.Errorf("read history of %s: %w", layer, err)
	}
	defer func() { _ = rows.Close() }()
	var out []HistoryRow
	for rows.Next() {
		var h HistoryRow
		if err := rows.Scan(&h.FID, &h.Revision, &h.Category, &h.ReferenceLabel, &h.ReferenceDate, &h.Notes,
			&h.Annotator, &h.SourceImageID, &h.ReferenceImageID, &h.OpenedAt, &h.SavedAt); err != nil {
			return nil, fmt.Errorf("read history of %s: %w", layer, err)
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
