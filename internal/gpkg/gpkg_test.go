package gpkg

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"math"
	"path/filepath"
	"strings"
	"testing"
)

// wkb builds geometry blobs for the tests, in either byte order.
type wkb struct {
	buf   bytes.Buffer
	order binary.ByteOrder
}

func newWKB(order binary.ByteOrder) *wkb { return &wkb{order: order} }

func (w *wkb) head(code uint32) *wkb {
	if w.order == binary.LittleEndian {
		w.buf.WriteByte(1)
	} else {
		w.buf.WriteByte(0)
	}
	_ = binary.Write(&w.buf, w.order, code)
	return w
}

func (w *wkb) n(n uint32) *wkb { _ = binary.Write(&w.buf, w.order, n); return w }

func (w *wkb) xy(v ...float64) *wkb {
	for _, f := range v {
		_ = binary.Write(&w.buf, w.order, math.Float64bits(f))
	}
	return w
}

// blob wraps WKB in a GP header with the given flags and envelope.
func blob(flags byte, envelope []float64, body []byte) []byte {
	var b bytes.Buffer
	b.Write([]byte{'G', 'P', 0, flags})
	order := binary.ByteOrder(binary.BigEndian)
	if flags&1 == 1 {
		order = binary.LittleEndian
	}
	_ = binary.Write(&b, order, int32(4326))
	for _, f := range envelope {
		_ = binary.Write(&b, order, math.Float64bits(f))
	}
	b.Write(body)
	return b.Bytes()
}

func TestDecodeReadsAPointWrittenByEncodePoint(t *testing.T) {
	d, err := Decode(EncodePoint(-63.071535, -7.550917), identity)
	if err != nil {
		t.Fatal(err)
	}
	p := d.Position()
	if p == nil || p[0] != -63.071535 || p[1] != -7.550917 {
		t.Fatalf("position = %v", p)
	}
	if d.Geometry.Type != "Point" {
		t.Fatalf("type = %s", d.Geometry.Type)
	}
}

func TestDecodeSkipsTheEnvelopeTheHeaderDeclares(t *testing.T) {
	body := newWKB(binary.BigEndian).head(1).xy(10, 20).buf.Bytes()
	// Indicator 1 (32 bytes of envelope), big-endian header.
	d, err := Decode(blob(0x02, []float64{10, 10, 20, 20}, body), identity)
	if err != nil {
		t.Fatal(err)
	}
	if p := d.Position(); p == nil || p[0] != 10 || p[1] != 20 {
		t.Fatalf("position = %v", p)
	}
}

func TestDecodeDropsZFromAnISOPointZ(t *testing.T) {
	body := newWKB(binary.LittleEndian).head(1001).xy(1, 2, 300).buf.Bytes()
	d, err := Decode(blob(0x01, nil, body), identity)
	if err != nil {
		t.Fatal(err)
	}
	if c := d.Geometry.Coordinates.([2]float64); c != [2]float64{1, 2} {
		t.Fatalf("coordinates = %v", c)
	}
}

func TestDecodeReadsAMultiPolygonAndItsBoundingBox(t *testing.T) {
	w := newWKB(binary.LittleEndian).head(6).n(2)
	w.head(3).n(1).n(4).xy(0, 0, 4, 0, 4, 4, 0, 0)
	w.head(3).n(1).n(4).xy(10, 10, 12, 10, 12, 13, 10, 10)
	d, err := Decode(blob(0x01, nil, w.buf.Bytes()), identity)
	if err != nil {
		t.Fatal(err)
	}
	polys := d.Geometry.Coordinates.([][][][2]float64)
	if d.Geometry.Type != "MultiPolygon" || len(polys) != 2 || len(polys[1][0]) != 4 {
		t.Fatalf("geometry = %+v", d.Geometry)
	}
	if *d.BBox != (BBox{MinX: 0, MinY: 0, MaxX: 12, MaxY: 13}) {
		t.Fatalf("bbox = %+v", *d.BBox)
	}
	if p := d.Position(); p[0] != 6 || p[1] != 6.5 {
		t.Fatalf("a non-point position is the centre of the box, got %v", p)
	}
}

func TestDecodeTreatsNaNCoordinatesAsAnEmptyPoint(t *testing.T) {
	body := newWKB(binary.LittleEndian).head(1).xy(math.NaN(), math.NaN()).buf.Bytes()
	d, err := Decode(blob(0x11, nil, body), identity)
	if err != nil {
		t.Fatal(err)
	}
	if d.Position() != nil {
		t.Fatalf("an empty point has no position, got %v", d.Position())
	}
}

func TestDecodeRefusesACountTheBlobCannotHold(t *testing.T) {
	body := newWKB(binary.LittleEndian).head(2).n(1<<30).xy(1, 2).buf.Bytes()
	if _, err := Decode(blob(0x01, nil, body), identity); err == nil {
		t.Fatal("a line claiming 2^30 points in 16 bytes was accepted")
	}
}

func TestDecodeRefusesABlobWithoutTheGPMagic(t *testing.T) {
	if _, err := Decode([]byte{1, 1, 0, 0, 0, 0, 0, 0, 0}, identity); err == nil {
		t.Fatal("plain WKB was accepted as a GeoPackage geometry")
	}
}

func TestWebMercatorConversionsInvertEachOther(t *testing.T) {
	x, y := lonLatToWebMercator(-63.07, -7.55)
	lon, lat := webMercatorToLonLat(x, y)
	if math.Abs(lon+63.07) > 1e-9 || math.Abs(lat+7.55) > 1e-9 {
		t.Fatalf("round trip gave %v %v", lon, lat)
	}
}

func writeFixture(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture.gpkg")
	w, err := Create(path)
	if err != nil {
		t.Fatal(err)
	}
	cols := []Column{{Name: "name", Type: "TEXT"}, {Name: "matched", Type: "BOOLEAN"}, {Name: "km", Type: "REAL"}}
	rows := []PointRow{
		{Lon: -63.07, Lat: -7.55, Values: []any{"ESCOLA A", 1, 4029.7}},
		{Lon: -48.0, Lat: -6.1, Values: []any{"ESCOLA B", 0, 1803.1}},
		{Lon: -35.0, Lat: -7.0, Values: []any{nil, 0, nil}},
	}
	if err := w.AddPointLayer("schools", "test schools", cols, rows); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAWrittenGeoPackageReadsBackWithItsValues(t *testing.T) {
	f, err := Open(writeFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	layers := f.Layers()
	if len(layers) != 1 || layers[0].Name != "schools" || layers[0].FeatureCount != 3 || !layers[0].IsPoints() {
		t.Fatalf("layers = %+v", layers)
	}
	if layers[0].PrimaryKey != "fid" || len(layers[0].Columns) != 3 || layers[0].SRS != "EPSG:4326" {
		t.Fatalf("layer = %+v", layers[0])
	}
	tab, err := f.Table("schools")
	if err != nil {
		t.Fatal(err)
	}
	r := tab.Rows[0]
	if r.Position[0] != -63.07 || r.Values[0] != "ESCOLA A" || r.Values[1] != true || r.Values[2] != 4029.7 {
		t.Fatalf("row = %+v %v", r, *r.Position)
	}
	if tab.Rows[2].Values[0] != nil {
		t.Fatalf("a NULL name came back as %v", tab.Rows[2].Values[0])
	}
}

func TestFilterFIDsRunsAConditionOnTheLayersColumns(t *testing.T) {
	f, err := Open(writeFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	ids, err := f.FilterFIDs("schools", "matched = 0 AND name IS NOT NULL")
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != 2 {
		t.Fatalf("ids = %v", ids)
	}
	if _, err := f.FilterFIDs("schools", "1 = 1; DROP TABLE schools"); err == nil {
		t.Fatal("a second statement was accepted")
	}
	if _, err := f.FilterFIDs("schools", "no_such_column = 1"); err == nil ||
		!strings.Contains(err.Error(), "no_such_column") {
		t.Fatalf("the error does not name the column: %v", err)
	}
}

func TestFeaturesInKeepsOnlyFeaturesInsideTheBox(t *testing.T) {
	f, err := Open(writeFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	fc, err := f.FeaturesIn("schools", BBox{MinX: -64, MinY: -8, MaxX: -47, MaxY: -6}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(fc.Features) != 2 || fc.Truncated {
		t.Fatalf("features = %d, truncated = %v", len(fc.Features), fc.Truncated)
	}
	fc, err = f.FeaturesIn("schools", BBox{MinX: -180, MinY: -90, MaxX: 180, MaxY: 90}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(fc.Features) != 1 || !fc.Truncated {
		t.Fatalf("a limit of 1 gave %d features, truncated = %v", len(fc.Features), fc.Truncated)
	}
}

func TestOpenNeverWritesTheSourceFile(t *testing.T) {
	path := writeFixture(t)
	f, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if _, err := f.db.Exec(`DELETE FROM schools`); err == nil {
		t.Fatal("a delete succeeded on a file opened for reading")
	}
}

func TestOpenRefusesAnSQLiteFileThatIsNotAGeoPackage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plain.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE t (a)`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "not a GeoPackage") {
		t.Fatalf("err = %v", err)
	}
}

func TestALayerInAProjectedSystemSaysWhyItCannotBeRead(t *testing.T) {
	_, _, err := projectionFor(31982, "EPSG", 31982, `PROJCS["SIRGAS 2000 / UTM zone 22S"]`)
	if err == nil || !strings.Contains(err.Error(), "EPSG:31982") {
		t.Fatalf("err = %v", err)
	}
}

func TestDistanceMetersGivesAbout111KilometresPerDegreeOfLatitude(t *testing.T) {
	if d := DistanceMeters(-63, -7, -63, -8); math.Abs(d-111195) > 10 {
		t.Fatalf("one degree of latitude = %.0f m", d)
	}
}

func TestNearestSearchesEveryNamedLayerAndWidensTheBoxUntilItIsSure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "two.gpkg")
	w, err := Create(path)
	if err != nil {
		t.Fatal(err)
	}
	cols := []Column{{Name: "name", Type: "TEXT"}}
	// A school at the point itself, a health post 111 m north, and a school
	// about 0.5 degree east, far outside the first box.
	if err := w.AddPointLayer("schools", "", cols, []PointRow{
		{Lon: -52.973855, Lat: -3.482511, Values: []any{"at the point"}},
		{Lon: -52.473855, Lat: -3.482511, Values: []any{"far east"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := w.AddPointLayer("health", "", cols, []PointRow{
		{Lon: -52.973855, Lat: -3.481511, Values: []any{"111 m north"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()

	near, err := f.Nearest([]string{"schools", "health"}, -52.973855, -3.482511, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(near) != 3 {
		t.Fatalf("found %d", len(near))
	}
	got := []string{near[0].Row.Values[0].(string), near[1].Row.Values[0].(string), near[2].Row.Values[0].(string)}
	if got[0] != "at the point" || got[1] != "111 m north" || got[2] != "far east" {
		t.Fatalf("order = %v", got)
	}
	if near[0].Meters > 0.01 || near[1].Layer != "health" || math.Abs(near[1].Meters-111.2) > 0.5 {
		t.Fatalf("near = %+v", near[:2])
	}
	only, err := f.Nearest([]string{"health"}, -52.973855, -3.482511, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(only) != 1 || only[0].Layer != "health" {
		t.Fatalf("a search of one layer returned %+v", only)
	}
}
