package exports

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"terra-point-check/internal/annotation"
)

func TestARecordWithoutAnAnswerBeforeTheLastAnswerWasPassedOver(t *testing.T) {
	recs := []annotation.SampleRecord{{FID: 7, Order: 1}, {FID: 3, Order: 2}, {FID: 9, Order: 3}, {FID: 1, Order: 4}}
	got := sampleStatus(recs, map[int64]string{7: "present", 9: "absent"})
	want := []string{statusAnswered, statusPassedOver, statusAnswered, statusNotReached}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("status = %v, want %v", got, want)
	}
}

func TestAnExportListsEachSampleRecordWithItsStatus(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.gpkg")
	if err := os.WriteFile(src, []byte("not read"), 0o644); err != nil {
		t.Fatal(err)
	}
	sum, err := annotation.HashFile(src)
	if err != nil {
		t.Fatal(err)
	}
	p, err := annotation.Create(filepath.Join(dir, "project"), "test", sum, annotation.Settings{Annotator: "A", Seed: 48213})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = p.Close() }()
	fids := make([]int64, 20)
	pop := make([]annotation.Member, 20)
	for i := range fids {
		fids[i] = int64(i + 1)
		pop[i] = annotation.Member{FID: fids[i]}
	}
	// Seed 48213 orders 1..20 as 1, 20, 16, 9, ...: the sample is 1, 20, 16.
	s, err := p.DrawSample(annotation.SampleDesign{Layer: "schools", Size: 3}, fids, pop, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Save(annotation.Draft{Layer: "schools", FID: 20, Category: "present"}, annotation.Snapshot{}); err != nil {
		t.Fatal(err)
	}
	res, err := Write(p, nil, filepath.Join(p.Dir(), "exports"))
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(filepath.Join(res.Dir, fmt.Sprintf("sample_%d.csv", s.ID)))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(f).ReadAll()
	_ = f.Close()
	if err != nil {
		t.Fatal(err)
	}
	var got [][2]string
	for _, r := range rows[1:] {
		got = append(got, [2]string{r[2], r[5]})
	}
	want := [][2]string{{"1", statusPassedOver}, {"20", statusAnswered}, {"16", statusNotReached}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("sample records = %v, want %v", got, want)
	}
	if _, err := os.Stat(filepath.Join(res.Dir, "samples.csv")); err != nil {
		t.Fatal(err)
	}
	page, err := os.ReadFile(filepath.Join(res.Dir, "report.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Estimated share of each category", "1 has a category, 1 was passed over and 1 is",
		"Wilson score"} {
		if !strings.Contains(string(page), want) {
			t.Fatalf("the report does not say %q", want)
		}
	}
	if _, err := os.Stat(filepath.Join(res.Dir, "estimates_schools.csv")); err != nil {
		t.Fatal(err)
	}
}
