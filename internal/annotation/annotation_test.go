package annotation

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newProject(t *testing.T) (*Project, string) {
	t.Helper()
	dir := t.TempDir()
	src := filepath.Join(dir, "source.gpkg")
	if err := os.WriteFile(src, []byte("not really a geopackage"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := HashFile(src)
	if err != nil {
		t.Fatal(err)
	}
	p, err := Create(filepath.Join(dir, "project"), "test", s, Settings{Annotator: "A"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.Close() })
	return p, src
}

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestANewProjectGetsTheDefaultCategoriesAndASeed(t *testing.T) {
	p, _ := newProject(t)
	info, err := p.Info()
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Settings.Categories) != len(DefaultCategories()) || info.Settings.Seed == 0 {
		t.Fatalf("settings = %+v", info.Settings)
	}
	if info.SourceStatus != SourceSame {
		t.Fatalf("status = %s", info.SourceStatus)
	}
}

func TestCreateRefusesAFolderThatAlreadyHoldsAProject(t *testing.T) {
	p, src := newProject(t)
	s, _ := HashFile(src)
	if _, err := Create(p.Dir(), "again", s, Settings{}); err == nil {
		t.Fatal("a second project was created over the first")
	}
}

func TestEverySaveThatChangesSomethingAddsARevisionAndKeepsTheFirstCategory(t *testing.T) {
	p, _ := newProject(t)
	snap := Snapshot{RecordID: "109775085", RecordName: "IFAM"}
	if _, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "present"}, snap); err != nil {
		t.Fatal(err)
	}
	// The same answer again is not a revision.
	if _, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "present"}, snap); err != nil {
		t.Fatal(err)
	}
	r, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "other_use", ReferenceLabel: "Restaurante"}, snap)
	if err != nil {
		t.Fatal(err)
	}
	if r.Revisions != 2 || r.Annotation.Revision != 2 {
		t.Fatalf("revisions = %d, revision = %d", r.Revisions, r.Annotation.Revision)
	}
	if r.Annotation.Category != "other_use" || r.Annotation.FirstCategory != "present" {
		t.Fatalf("annotation = %+v", r.Annotation)
	}
	h, err := p.History("schools", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 2 || h[0].Category != "present" || h[1].ReferenceLabel != "Restaurante" || h[0].Annotator != "A" {
		t.Fatalf("history = %+v", h)
	}
}

func TestTheHistoryRefusesUpdatesAndDeletes(t *testing.T) {
	p, _ := newProject(t)
	if _, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "present"}, Snapshot{}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.db.Exec(`UPDATE annotation_history SET category = 'absent'`); err == nil {
		t.Fatal("an update of the history succeeded")
	}
	if _, err := p.db.Exec(`DELETE FROM annotation_history`); err == nil {
		t.Fatal("a delete from the history succeeded")
	}
}

func TestSaveRefusesACategoryTheProjectDoesNotHave(t *testing.T) {
	p, _ := newProject(t)
	if _, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "closed"}, Snapshot{}); err == nil {
		t.Fatal("an unknown category was saved")
	}
}

func TestACategoryInUseCannotBeRemovedButCanBeRelabelled(t *testing.T) {
	p, _ := newProject(t)
	if _, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "absent"}, Snapshot{}); err != nil {
		t.Fatal(err)
	}
	s, _ := p.Settings()
	var kept []Category
	for _, c := range s.Categories {
		if c.ID != "absent" {
			kept = append(kept, c)
		}
	}
	err := p.UpdateSettings(Settings{Categories: kept})
	if err == nil || !strings.Contains(err.Error(), "absent") {
		t.Fatalf("err = %v", err)
	}
	for i := range s.Categories {
		if s.Categories[i].ID == "absent" {
			s.Categories[i].Label = "Terreno vazio"
		}
	}
	if err := p.UpdateSettings(s); err != nil {
		t.Fatal(err)
	}
}

func TestAReplacedScreenshotKeepsItsFile(t *testing.T) {
	p, _ := newProject(t)
	first, err := p.AddImage("schools", 7, SideReference, pngBytes(t, 4, 3), OriginClipboard, "")
	if err != nil {
		t.Fatal(err)
	}
	if first.Width == nil || *first.Width != 4 || *first.Height != 3 {
		t.Fatalf("size = %v x %v", first.Width, first.Height)
	}
	second, err := p.AddImage("schools", 7, SideReference, pngBytes(t, 5, 5), OriginFile, "maps.png")
	if err != nil {
		t.Fatal(err)
	}
	r, err := p.Record("schools", 7)
	if err != nil {
		t.Fatal(err)
	}
	if r.ReferenceImage == nil || r.ReferenceImage.ID != second.ID || r.SourceImage != nil {
		t.Fatalf("record = %+v", r)
	}
	if _, err := os.Stat(filepath.Join(p.Dir(), filepath.FromSlash(first.Path))); err != nil {
		t.Fatalf("the replaced file is gone: %v", err)
	}
	sums, err := p.Summaries("schools")
	if err != nil {
		t.Fatal(err)
	}
	if len(sums) != 1 || !sums[0].HasReferenceImage || sums[0].Saved {
		t.Fatalf("summaries = %+v", sums)
	}
}

func TestAddImageRefusesAFileThatIsNotAnImage(t *testing.T) {
	p, _ := newProject(t)
	if _, err := p.AddImage("schools", 1, SideSource, []byte("%PDF-1.7"), OriginFile, ""); err == nil {
		t.Fatal("a PDF was stored as a screenshot")
	}
}

func TestImageFileRefusesPathsOutsideTheImagesFolder(t *testing.T) {
	p, _ := newProject(t)
	for _, bad := range []string{"../annotations.sqlite", "annotations.sqlite", "images/../../etc/passwd"} {
		if got, err := p.ImageFile(bad); err == nil {
			t.Fatalf("%s resolved to %s", bad, got)
		}
	}
	got, err := p.ImageFile("images/schools/1/a.png")
	if err != nil || !strings.HasPrefix(got, p.Dir()) {
		t.Fatalf("got %s, %v", got, err)
	}
}

func TestInfoSaysWhenTheSourceFileChanged(t *testing.T) {
	p, src := newProject(t)
	if err := os.WriteFile(src, []byte("another file"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := p.Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.SourceStatus != SourceChanged || info.CurrentSHA256 == "" {
		t.Fatalf("info = %+v", info)
	}
	if err := p.Relink(src, false); err == nil {
		t.Fatal("a changed file was relinked without being accepted")
	}
	if err := p.Relink(src, true); err != nil {
		t.Fatal(err)
	}
	if info, _ = p.Info(); info.SourceStatus != SourceSame {
		t.Fatalf("status after relink = %s", info.SourceStatus)
	}
}

func TestAProjectReopensWithItsAnswers(t *testing.T) {
	p, _ := newProject(t)
	if _, err := p.Save(Draft{Layer: "schools", FID: 3, Notes: "telhado caído"}, Snapshot{}); err != nil {
		t.Fatal(err)
	}
	dir := p.Dir()
	_ = p.Close()
	q, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = q.Close() }()
	r, err := q.Record("schools", 3)
	if err != nil {
		t.Fatal(err)
	}
	if r.Annotation == nil || r.Annotation.Notes != "telhado caído" || r.Annotation.Category != "" {
		t.Fatalf("record = %+v", r.Annotation)
	}
}

func TestAMapCaptureKeepsTheDateAndSourceOfItsImagery(t *testing.T) {
	p, _ := newProject(t)
	img, err := p.AddMapCapture("schools", 1, pngBytes(t, 4, 4), "Esri World Imagery, zoom 16.0",
		Imagery{Date: "2025-04-14", Source: "WV03, 0.31 m, Vantor"})
	if err != nil {
		t.Fatal(err)
	}
	if img.Origin != OriginAppMap || img.Side != SideSource || img.ImageryDate != "2025-04-14" ||
		img.ImagerySource != "WV03, 0.31 m, Vantor" {
		t.Fatalf("capture = %+v", img)
	}
	if _, err := p.AddMapCapture("schools", 1, pngBytes(t, 4, 4), "", Imagery{Date: "14/04/2025"}); err == nil {
		t.Fatal("a date that is not YYYY-MM-DD was kept")
	}
	pasted, err := p.AddImage("schools", 1, SideReference, pngBytes(t, 4, 4), OriginClipboard, "")
	if err != nil || pasted.ImageryDate != "" || pasted.ImagerySource != "" {
		t.Fatalf("a pasted screenshot = %+v, %v", pasted, err)
	}
}
