package annotation

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// writeVersion1Project writes a project database as the first version of the
// application did, with one answer and its history row.
func writeVersion1Project(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "old")
	if err := os.MkdirAll(filepath.Join(dir, ImagesDir), 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := openDB(filepath.Join(dir, DBFile), true)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	src, _ := json.Marshal(Source{Path: filepath.Join(dir, "missing.gpkg"), SHA256: "00"})
	set, _ := json.Marshal(Settings{Annotator: "A", Categories: DefaultCategories(), Seed: 7})
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	for k, v := range map[string]string{"schema_version": "1", "name": "old", "created_at": "2026-01-01T00:00:00Z",
		"source": string(src), "settings": string(set)} {
		if _, err := db.Exec(`INSERT INTO project (key, value) VALUES (?, ?)`, k, v); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO annotation (layer, fid, category, first_category, created_at, updated_at, revision)
		VALUES ('schools', 1, 'present', 'present', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO annotation_history (layer, fid, revision, category, reference_label, notes, annotator, saved_at)
		VALUES ('schools', 1, 1, 'present', '', '', 'A', '2026-01-02T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAVersion1ProjectIsUpgradedWithItsAnswersAndACopyIsKept(t *testing.T) {
	dir := writeVersion1Project(t)
	p, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = p.Close() }()
	v, err := p.value("schema_version")
	if err != nil || v != strconv.Itoa(schemaVersion) {
		t.Fatalf("schema_version = %q, %v", v, err)
	}
	r, err := p.Record("schools", 1)
	if err != nil || r.Annotation == nil || r.Annotation.Category != "present" || r.Revisions != 1 {
		t.Fatalf("record after the upgrade = %+v, %v", r, err)
	}
	h, err := p.History("schools", 1)
	if err != nil || len(h) != 1 || h[0].OpenedAt != nil {
		t.Fatalf("history after the upgrade = %+v, %v", h, err)
	}
	// The history keeps its triggers through the upgrade.
	if _, err := p.db.Exec(`DELETE FROM annotation_history`); err == nil {
		t.Fatal("a history row was deleted after the upgrade")
	}
	old, err := openDB(filepath.Join(dir, "annotations.schema-1.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = old.Close() }()
	if err := old.QueryRow(`SELECT value FROM project WHERE key = 'schema_version'`).Scan(&v); err != nil || v != "1" {
		t.Fatalf("the kept copy has schema_version %q, %v", v, err)
	}
}

func TestAProjectFromANewerBuildIsRefused(t *testing.T) {
	p, _ := newProject(t)
	if err := p.setValue("schema_version", strconv.Itoa(schemaVersion+1)); err != nil {
		t.Fatal(err)
	}
	dir := p.Dir()
	_ = p.Close()
	if q, err := Open(dir); err == nil {
		_ = q.Close()
		t.Fatal("a project from a newer build was opened")
	}
}

func TestTheReferenceDateIsCheckedAndKeptWithTheOpeningTime(t *testing.T) {
	p, _ := newProject(t)
	for _, bad := range []string{"2023-13", "14/03/2023", "2023-02-30", "soon"} {
		if _, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "present", ReferenceDate: bad}, Snapshot{}); err == nil {
			t.Fatalf("the date %q was accepted", bad)
		}
	}
	for i, good := range []string{"2023", "2023-03", "2023-03-14", ReferenceDateNotShown} {
		d := Draft{Layer: "schools", FID: int64(i + 1), Category: "present", ReferenceDate: good,
			OpenedAt: "2026-03-01T10:00:00.250Z"}
		r, err := p.Save(d, Snapshot{})
		if err != nil || r.Annotation.ReferenceDate != good {
			t.Fatalf("saving %q: %+v, %v", good, r, err)
		}
		h, err := p.History("schools", int64(i+1))
		if err != nil || len(h) != 1 || h[0].OpenedAt == nil || *h[0].OpenedAt != "2026-03-01T10:00:00Z" {
			t.Fatalf("history of %q = %+v, %v", good, h, err)
		}
	}
	// A changed date alone is a revision, and an opening time after the save
	// is not kept.
	r, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "present", ReferenceDate: "2022",
		OpenedAt: "2999-01-01T00:00:00Z"}, Snapshot{})
	if err != nil || r.Revisions != 2 {
		t.Fatalf("revisions = %+v, %v", r, err)
	}
	h, _ := p.History("schools", 1)
	if h[1].OpenedAt != nil {
		t.Fatalf("an opening time after the save was kept as %q", *h[1].OpenedAt)
	}
}
