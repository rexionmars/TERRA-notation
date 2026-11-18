/*
Package exports writes what a project holds into files other tools read: a CSV
of the current answers, a CSV of every revision, a GeoPackage of the annotated
points with the source attributes, and an HTML page that puts each pair of
screenshots side by side.

An export is a new folder each time, named for the moment it was made, so an
earlier export that a result was computed from is never overwritten.
*/
package exports

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"terra-point-check/internal/annotation"
	"terra-point-check/internal/gpkg"
)

// Result lists what an export wrote.
type Result struct {
	Dir    string        `json:"dir"`
	Files  []string      `json:"files"`
	Layers []LayerResult `json:"layers"`
}

// LayerResult counts what was exported for one layer.
type LayerResult struct {
	Layer     string `json:"layer"`
	Records   int    `json:"records"`
	Revisions int    `json:"revisions"`
	// WithoutPosition counts records left out of the GeoPackage because
	// neither the source nor the annotation has a position for them.
	WithoutPosition int `json:"without_position"`
}

// record joins one feature's annotation, screenshots and source row.
type record struct {
	fid       int64
	ann       *annotation.Annotation
	src       *annotation.Image
	ref       *annotation.Image
	row       *gpkg.Row
	revisions int
}

func (r record) name() string {
	if r.ann != nil {
		return r.ann.RecordName
	}
	return ""
}

type layerData struct {
	name      string
	columns   []gpkg.Column
	records   []record
	history   []annotation.HistoryRow
	sourceErr string
	// sample is the layer's current sample, nil when it has none, and
	// sampleRecords its records in order.
	sample        *annotation.Sample
	sampleRecords []annotation.SampleRecord
	shares        []share
	pace          annotation.Pace
}

// Write exports every layer with annotations or screenshots into a new
// folder under parent. src may be nil when the GeoPackage cannot be opened;
// the export then has no source attributes.
func Write(p *annotation.Project, src *gpkg.File, parent string) (*Result, error) {
	info, err := p.Info()
	if err != nil {
		return nil, err
	}
	layers, err := p.AnnotatedLayers()
	if err != nil {
		return nil, err
	}
	if len(layers) == 0 {
		return nil, fmt.Errorf("the project has no annotations or screenshots to export yet")
	}
	stamp := time.Now().Format("2006-01-02_150405")
	dir := filepath.Join(parent, stamp)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create export folder: %w", err)
	}
	res := &Result{Dir: dir}
	var all []layerData
	for _, name := range layers {
		ld, err := collect(p, src, name, info.Settings.Categories)
		if err != nil {
			return nil, err
		}
		all = append(all, ld)
	}
	labels := map[string]string{}
	for _, c := range info.Settings.Categories {
		labels[c.ID] = c.Label
	}
	for _, ld := range all {
		f := filepath.Join(dir, "annotations_"+ld.name+".csv")
		if err := writeCurrentCSV(f, ld, labels, info); err != nil {
			return nil, err
		}
		h := filepath.Join(dir, "history_"+ld.name+".csv")
		if err := writeHistoryCSV(h, ld, labels); err != nil {
			return nil, err
		}
		var sampleID *int64
		if ld.sample != nil {
			sampleID = &ld.sample.ID
		}
		e, err := writeEstimates(dir, ld.name, sampleID, ld.shares, labels)
		if err != nil {
			return nil, err
		}
		res.Files = append(res.Files, f, h, e)
	}
	sampleFiles, err := writeSamples(dir, p, labels)
	if err != nil {
		return nil, err
	}
	res.Files = append(res.Files, sampleFiles...)
	g := filepath.Join(dir, "annotations.gpkg")
	counts, err := writeGeoPackage(g, all, labels, info)
	if err != nil {
		return nil, err
	}
	res.Files = append(res.Files, g)
	page := filepath.Join(dir, "report.html")
	if err := writeReport(page, dir, p.Dir(), all, labels, info); err != nil {
		return nil, err
	}
	res.Files = append(res.Files, page)
	for i, ld := range all {
		res.Layers = append(res.Layers, LayerResult{
			Layer: ld.name, Records: len(ld.records), Revisions: len(ld.history), WithoutPosition: counts[i],
		})
	}
	return res, nil
}

func collect(p *annotation.Project, src *gpkg.File, name string, cats []annotation.Category) (layerData, error) {
	ld := layerData{name: name}
	sums, err := p.Summaries(name)
	if err != nil {
		return ld, err
	}
	rows := map[int64]*gpkg.Row{}
	if src != nil {
		if t, err := src.Table(name); err == nil {
			ld.columns = t.Columns
			for i := range t.Rows {
				rows[t.Rows[i].FID] = &t.Rows[i]
			}
		} else {
			ld.sourceErr = err.Error()
		}
	}
	for _, s := range sums {
		rec, err := p.Record(name, s.FID)
		if err != nil {
			return ld, err
		}
		ld.records = append(ld.records, record{
			fid: s.FID, ann: rec.Annotation, src: rec.SourceImage, ref: rec.ReferenceImage,
			row: rows[s.FID], revisions: rec.Revisions,
		})
	}
	sort.Slice(ld.records, func(i, j int) bool { return ld.records[i].fid < ld.records[j].fid })
	if ld.history, err = p.LayerHistory(name); err != nil {
		return ld, err
	}
	if ld.sample, err = p.CurrentSample(name); err != nil {
		return ld, err
	}
	if ld.sample != nil {
		if ld.sampleRecords, err = p.SampleRecords(ld.sample.ID); err != nil {
			return ld, err
		}
	}
	category := map[int64]string{}
	for _, r := range ld.records {
		if r.ann != nil {
			category[r.fid] = r.ann.Category
		}
	}
	ld.shares = layerShares(ld.sample, ld.sampleRecords, cats, category)
	if ld.pace, err = p.LayerPace(name); err != nil {
		return ld, err
	}
	return ld, nil
}

func cell(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(x, 10)
	case bool:
		if x {
			return "1"
		}
		return "0"
	default:
		return fmt.Sprint(x)
	}
}

func floatCell(f *float64) string {
	if f == nil {
		return ""
	}
	return strconv.FormatFloat(*f, 'f', -1, 64)
}

func imageCells(img *annotation.Image) (string, string) {
	if img == nil {
		return "", ""
	}
	return img.Path, img.SHA256
}

// position is the point a record is drawn at: the source geometry when the
// layer still has the feature, the position saved with the annotation if not.
func (r record) position() (lon, lat *float64) {
	if r.row != nil && r.row.Position != nil {
		return &r.row.Position[0], &r.row.Position[1]
	}
	if r.ann != nil {
		return r.ann.Lon, r.ann.Lat
	}
	return nil, nil
}

func writeCSV(path string, header []string, rows [][]string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	w := csv.NewWriter(f)
	if err := w.Write(header); err != nil {
		_ = f.Close()
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	if err := w.WriteAll(rows); err != nil {
		_ = f.Close()
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return nil
}

/*
referenceDateCells splits the stored date of the reference imagery into the
date and what its absence means: the reference map showed none, or nobody
wrote it down.
*/
func referenceDateCells(d string) (date, status string) {
	switch d {
	case "":
		return "", "not recorded"
	case annotation.ReferenceDateNotShown:
		return "", "not shown"
	default:
		return d, "recorded"
	}
}

func writeCurrentCSV(path string, ld layerData, labels map[string]string, info annotation.Info) error {
	header := []string{"layer", "fid", "record_id", "record_name", "lon", "lat", "category", "category_label",
		"first_category", "revisions", "reference_label", "reference_imagery_date", "reference_imagery_date_status",
		"notes", "annotator", "created_at", "updated_at",
		"source_image", "source_image_sha256", "source_imagery_date", "source_imagery",
		"reference_image", "reference_image_sha256", "source_gpkg", "source_gpkg_sha256"}
	for _, c := range ld.columns {
		header = append(header, "gpkg_"+c.Name)
	}
	var rows [][]string
	for _, r := range ld.records {
		lon, lat := r.position()
		row := []string{ld.name, strconv.FormatInt(r.fid, 10)}
		if a := r.ann; a != nil {
			date, status := referenceDateCells(a.ReferenceDate)
			row = append(row, a.RecordID, a.RecordName, floatCell(lon), floatCell(lat), a.Category, labels[a.Category],
				a.FirstCategory, strconv.Itoa(r.revisions), a.ReferenceLabel, date, status, a.Notes, a.Annotator,
				a.CreatedAt, a.UpdatedAt)
		} else {
			row = append(row, "", "", floatCell(lon), floatCell(lat), "", "", "", "0", "", "", "", "", "", "", "")
		}
		sp, ss := imageCells(r.src)
		rp, rs := imageCells(r.ref)
		var imageryDate, imagery string
		if r.src != nil {
			imageryDate, imagery = r.src.ImageryDate, r.src.ImagerySource
		}
		row = append(row, sp, ss, imageryDate, imagery, rp, rs, info.Source.Path, info.Source.SHA256)
		for i := range ld.columns {
			if r.row != nil {
				row = append(row, cell(r.row.Values[i]))
			} else {
				row = append(row, "")
			}
		}
		rows = append(rows, row)
	}
	return writeCSV(path, header, rows)
}

func idCell(id *int64) string {
	if id == nil {
		return ""
	}
	return strconv.FormatInt(*id, 10)
}

func writeHistoryCSV(path string, ld layerData, labels map[string]string) error {
	header := []string{"layer", "fid", "revision", "category", "category_label", "reference_label",
		"reference_imagery_date", "reference_imagery_date_status", "notes", "annotator", "source_image_id",
		"reference_image_id", "opened_at", "saved_at"}
	var rows [][]string
	for _, h := range ld.history {
		date, status := referenceDateCells(h.ReferenceDate)
		opened := ""
		if h.OpenedAt != nil {
			opened = *h.OpenedAt
		}
		rows = append(rows, []string{ld.name, strconv.FormatInt(h.FID, 10), strconv.Itoa(h.Revision), h.Category,
			labels[h.Category], h.ReferenceLabel, date, status, h.Notes, h.Annotator, idCell(h.SourceImageID),
			idCell(h.ReferenceImageID), opened, h.SavedAt})
	}
	return writeCSV(path, header, rows)
}

var annotationGpkgColumns = []gpkg.Column{
	{Name: "source_fid", Type: "INTEGER"},
	{Name: "category", Type: "TEXT"},
	{Name: "category_label", Type: "TEXT"},
	{Name: "first_category", Type: "TEXT"},
	{Name: "revisions", Type: "INTEGER"},
	{Name: "reference_label", Type: "TEXT"},
	{Name: "reference_imagery_date", Type: "TEXT"},
	{Name: "reference_imagery_date_status", Type: "TEXT"},
	{Name: "notes", Type: "TEXT"},
	{Name: "annotator", Type: "TEXT"},
	{Name: "updated_at", Type: "DATETIME"},
	{Name: "source_image", Type: "TEXT"},
	{Name: "reference_image", Type: "TEXT"},
}

func writeGeoPackage(path string, all []layerData, labels map[string]string, info annotation.Info) ([]int, error) {
	w, err := gpkg.Create(path)
	if err != nil {
		return nil, err
	}
	skipped := make([]int, len(all))
	for li, ld := range all {
		cols := append([]gpkg.Column{}, annotationGpkgColumns...)
		taken := map[string]bool{"fid": true, "geom": true}
		for _, c := range cols {
			taken[strings.ToLower(c.Name)] = true
		}
		for _, c := range ld.columns {
			name := c.Name
			if taken[strings.ToLower(name)] {
				name = "gpkg_" + name
			}
			taken[strings.ToLower(name)] = true
			cols = append(cols, gpkg.Column{Name: name, Type: c.Type})
		}
		var rows []gpkg.PointRow
		for _, r := range ld.records {
			lon, lat := r.position()
			if lon == nil || lat == nil {
				skipped[li]++
				continue
			}
			vals := []any{r.fid}
			if a := r.ann; a != nil {
				date, status := referenceDateCells(a.ReferenceDate)
				vals = append(vals, a.Category, labels[a.Category], a.FirstCategory, r.revisions,
					a.ReferenceLabel, date, status, a.Notes, a.Annotator, a.UpdatedAt)
			} else {
				vals = append(vals, "", "", "", 0, "", "", "", "", "", nil)
			}
			sp, _ := imageCells(r.src)
			rp, _ := imageCells(r.ref)
			vals = append(vals, sp, rp)
			for i := range ld.columns {
				if r.row != nil {
					vals = append(vals, r.row.Values[i])
				} else {
					vals = append(vals, nil)
				}
			}
			rows = append(rows, gpkg.PointRow{Lon: *lon, Lat: *lat, Values: vals})
		}
		desc := fmt.Sprintf("annotations of %s from %s (sha256 %s)", ld.name, filepath.Base(info.Source.Path), info.Source.SHA256)
		if err := w.AddPointLayer(ld.name+"_annotations", desc, cols, rows); err != nil {
			_ = w.Close()
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return skipped, nil
}
