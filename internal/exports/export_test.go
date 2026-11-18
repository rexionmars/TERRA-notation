package exports

import (
	"bytes"
	"encoding/csv"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"terra-point-check/internal/annotation"
	"terra-point-check/internal/gpkg"
)

func TestAnExportCarriesTheAnswersTheHistoryAndTheSourceAttributes(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "source.gpkg")
	w, err := gpkg.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddPointLayer("schools", "", []gpkg.Column{{Name: "name", Type: "TEXT"}, {Name: "category", Type: "TEXT"}},
		[]gpkg.PointRow{
			{Lon: -63.07, Lat: -7.55, Values: []any{"ESCOLA A", "municipal"}},
			{Lon: -48.0, Lat: -6.1, Values: []any{"ESCOLA B", "estadual"}},
		}); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	src, err := gpkg.Open(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = src.Close() }()
	sum, err := annotation.HashFile(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	p, err := annotation.Create(filepath.Join(dir, "project"), "teste", sum, annotation.Settings{Annotator: "A"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = p.Close() }()

	snap := annotation.Snapshot{RecordName: "ESCOLA A"}
	if _, err := p.Save(annotation.Draft{Layer: "schools", FID: 1, Category: "present"}, snap); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Save(annotation.Draft{Layer: "schools", FID: 1, Category: "other_use", ReferenceLabel: "Restaurante, vírgula",
		ReferenceDate: annotation.ReferenceDateNotShown}, snap); err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if _, err := p.AddImage("schools", 2, annotation.SideReference, b.Bytes(), annotation.OriginClipboard, ""); err != nil {
		t.Fatal(err)
	}

	res, err := Write(p, src, filepath.Join(p.Dir(), "exports"))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Layers) != 1 || res.Layers[0].Records != 2 || res.Layers[0].Revisions != 2 {
		t.Fatalf("result = %+v", res.Layers)
	}

	f, err := os.Open(filepath.Join(res.Dir, "annotations_schools.csv"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(f).ReadAll()
	_ = f.Close()
	if err != nil {
		t.Fatal(err)
	}
	col := map[string]int{}
	for i, h := range rows[0] {
		col[h] = i
	}
	first := rows[1]
	if first[col["category"]] != "other_use" || first[col["first_category"]] != "present" ||
		first[col["reference_label"]] != "Restaurante, vírgula" || first[col["gpkg_name"]] != "ESCOLA A" {
		t.Fatalf("row = %v", first)
	}
	// A date the reference map did not show is an empty date with its reason.
	if first[col["reference_imagery_date"]] != "" || first[col["reference_imagery_date_status"]] != "not shown" {
		t.Fatalf("reference imagery date = %q, %q", first[col["reference_imagery_date"]],
			first[col["reference_imagery_date_status"]])
	}
	if rows[2][col["reference_image"]] == "" || rows[2][col["category"]] != "" {
		t.Fatalf("a record with only a screenshot is exported as %v", rows[2])
	}

	out, err := gpkg.Open(filepath.Join(res.Dir, "annotations.gpkg"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = out.Close() }()
	tab, err := out.Table("schools_annotations")
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]int{}
	for i, c := range tab.Columns {
		names[c.Name] = i
	}
	// The source's own "category" column cannot take the annotation's name.
	if _, ok := names["gpkg_category"]; !ok {
		t.Fatalf("columns = %v", tab.Columns)
	}
	if tab.Rows[0].Values[names["category"]] != "other_use" || tab.Rows[0].Values[names["gpkg_category"]] != "municipal" {
		t.Fatalf("row = %v", tab.Rows[0].Values)
	}

	page, err := os.ReadFile(filepath.Join(res.Dir, "report.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(page), "../../images/schools/2/") || !strings.Contains(string(page), "\u22127.550000") {
		t.Fatalf("the report does not reference the screenshot or write the latitude with a typographic minus")
	}
}

func TestFormatNumberWritesTheTypographicMinus(t *testing.T) {
	if got := formatNumber(-7.5509, 3); got != "\u22127.551" {
		t.Fatalf("got %q", got)
	}
}

func TestTwoExportsInTheSameSecondGoToSeparateFolders(t *testing.T) {
	parent := t.TempDir()
	seen := map[string]bool{}
	for i := 0; i < 5; i++ {
		dir, err := newExportDir(parent, "")
		if err != nil {
			t.Fatal(err)
		}
		if seen[dir] {
			t.Fatalf("export %d reused %s", i, dir)
		}
		seen[dir] = true
	}
}
