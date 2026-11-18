package exports

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"terra-point-check/internal/annotation"
)

func TestAgreementComparesTheFirstAnswersOfBothReadings(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.gpkg")
	if err := os.WriteFile(src, []byte("not read"), 0o644); err != nil {
		t.Fatal(err)
	}
	sum, err := annotation.HashFile(src)
	if err != nil {
		t.Fatal(err)
	}
	first, err := annotation.Create(filepath.Join(dir, "first"), "first", sum,
		annotation.Settings{Annotator: "A", Seed: 7,
			Layers: map[string]annotation.LayerSettings{"schools": {HiddenColumns: []string{"matched"}}}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = first.Close() }()
	answers := map[int64]string{1: "present", 2: "present", 3: "absent", 4: "other_use"}
	for fid, c := range answers {
		if _, err := first.Save(annotation.Draft{Layer: "schools", FID: fid, Category: c}, annotation.Snapshot{}); err != nil {
			t.Fatal(err)
		}
	}
	// A revision after the second reading does not change the comparison,
	// which reads first answers.
	if _, err := first.Save(annotation.Draft{Layer: "schools", FID: 3, Category: "present"}, annotation.Snapshot{}); err != nil {
		t.Fatal(err)
	}
	second, err := first.CreateSecondReading(annotation.SecondReading{Dir: filepath.Join(dir, "second"),
		Annotator: "B", Layer: "schools", Size: 10})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = second.Close() }()
	info, err := second.Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.SecondReadingOf == nil || info.SecondReadingOf.Name != "first" ||
		len(info.Settings.Layers["schools"].HiddenColumns) != 1 || info.Settings.Annotator != "B" {
		t.Fatalf("second reading = %+v", info)
	}
	if r, err := second.Record("schools", 1); err != nil || r.Annotation != nil {
		t.Fatalf("the second reading starts with an answer: %+v, %v", r, err)
	}
	// B agrees on 1 and 3, disagrees on 2, and leaves 4 unanswered.
	for fid, c := range map[int64]string{1: "present", 2: "abandoned", 3: "absent"} {
		if _, err := second.Save(annotation.Draft{Layer: "schools", FID: fid, Category: c}, annotation.Snapshot{}); err != nil {
			t.Fatal(err)
		}
	}
	res, err := WriteAgreement(first, second)
	if err != nil {
		t.Fatal(err)
	}
	l := res.Layers[0]
	if l.Records != 4 || l.Pairs != 3 || l.Agreeing != 2 {
		t.Fatalf("agreement = %+v", l)
	}
	f, err := os.Open(filepath.Join(res.Dir, "agreement_matrix_schools.csv"))
	if err != nil {
		t.Fatal(err)
	}
	m, err := csv.NewReader(f).ReadAll()
	_ = f.Close()
	if err != nil {
		t.Fatal(err)
	}
	// Row "present" (first reading), column "abandoned" (second): record 2.
	col := map[string]int{}
	for i, h := range m[0] {
		col[h] = i
	}
	for _, row := range m[1:] {
		if row[0] == "present" && (row[col["present"]] != "1" || row[col["abandoned"]] != "1") {
			t.Fatalf("present row = %v", row)
		}
	}
	page, err := os.ReadFile(filepath.Join(res.Dir, "agreement.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(page), "for 2 of the 3 records both answered") ||
		!strings.Contains(string(page), "1 record of the second reading is left out") {
		t.Fatal("agreement.html does not give the counts")
	}
}

func TestAProjectThatIsNotASecondReadingIsRefused(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.gpkg")
	if err := os.WriteFile(src, []byte("not read"), 0o644); err != nil {
		t.Fatal(err)
	}
	sum, _ := annotation.HashFile(src)
	a, err := annotation.Create(filepath.Join(dir, "a"), "a", sum, annotation.Settings{Annotator: "A"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	b, err := annotation.Create(filepath.Join(dir, "b"), "b", sum, annotation.Settings{Annotator: "B"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = b.Close() }()
	if _, err := WriteAgreement(a, b); err == nil {
		t.Fatal("an unrelated project was compared as a second reading")
	}
}
