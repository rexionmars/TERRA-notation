/*
Package gpkg reads and writes the GeoPackage files the annotation works from.

A GeoPackage is an SQLite file with three metadata tables
(gpkg_spatial_ref_sys, gpkg_contents, gpkg_geometry_columns) and one table per
layer, whose geometry column holds a GP header followed by WKB. Reading it
needs SQLite and a WKB decoder and nothing else, so this package uses the
pure-Go SQLite driver the TERRA desktop application uses and no GDAL.

A source file is opened read-only. The annotations live in their own project
folder; the GeoPackage they refer to is never written.
*/
package gpkg

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"strings"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

// Column is one attribute column of a layer.
type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Layer describes one feature table.
type Layer struct {
	Name           string   `json:"name"`
	Title          string   `json:"title"`
	Description    string   `json:"description"`
	GeometryColumn string   `json:"geometry_column"`
	GeometryType   string   `json:"geometry_type"`
	SRS            string   `json:"srs"`
	PrimaryKey     string   `json:"primary_key"`
	Columns        []Column `json:"columns"`
	FeatureCount   int64    `json:"feature_count"`
	SpatialIndex   bool     `json:"spatial_index"`
	// Problem says why the layer cannot be read; it is empty when it can.
	Problem string `json:"problem"`
}

// IsPoints reports whether every feature of the layer is a point, which is
// what annotating one record at a time assumes.
func (l Layer) IsPoints() bool {
	t := strings.ToUpper(l.GeometryType)
	return t == "POINT" || t == "MULTIPOINT"
}

type layerInfo struct {
	Layer
	project   Projection
	unproject Projection
	rtree     string
}

// File is an open GeoPackage.
type File struct {
	db     *sql.DB
	path   string
	layers []*layerInfo
}

// Open opens a GeoPackage read-only and reads its feature layers.
func Open(path string) (*File, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("open geopackage: %w", err)
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open geopackage: %w", err)
	}
	f := &File{db: db, path: path}
	if err := f.loadLayers(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return f, nil
}

// Close closes the file.
func (f *File) Close() error { return f.db.Close() }

// Path is the file the GeoPackage was opened from.
func (f *File) Path() string { return f.path }

// Layers lists the feature layers in the order the file lists them: the
// rows of gpkg_contents, in the order the writer added them, which is the
// order QGIS and TERRA show them in and the order TERRA gives out colours.
func (f *File) Layers() []Layer {
	out := make([]Layer, len(f.layers))
	for i, l := range f.layers {
		out[i] = l.Layer
	}
	return out
}

func quote(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func (f *File) loadLayers() error {
	rows, err := f.db.Query(`
		SELECT c.table_name, COALESCE(c.identifier, ''), COALESCE(c.description, ''),
		       g.column_name, g.geometry_type_name, g.srs_id,
		       COALESCE(s.organization, ''), COALESCE(s.organization_coordsys_id, 0),
		       COALESCE(s.definition, '')
		FROM gpkg_contents c
		JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
		LEFT JOIN gpkg_spatial_ref_sys s ON s.srs_id = g.srs_id
		WHERE c.data_type = 'features'
		ORDER BY c.rowid`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return errors.New("the file is not a GeoPackage: it has no gpkg_contents or gpkg_geometry_columns table")
		}
		return fmt.Errorf("read gpkg_contents: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var (
			l            layerInfo
			srsID, orgID int64
			org, srsDef  string
		)
		if err := rows.Scan(&l.Name, &l.Title, &l.Description, &l.GeometryColumn,
			&l.GeometryType, &srsID, &org, &orgID, &srsDef); err != nil {
			return fmt.Errorf("read gpkg_contents: %w", err)
		}
		l.SRS = fmt.Sprintf("%s:%d", org, orgID)
		if org == "" {
			l.SRS = fmt.Sprintf("srs_id %d", srsID)
		}
		l.project, l.unproject, err = projectionFor(srsID, org, orgID, srsDef)
		if err != nil {
			l.Problem = err.Error()
		}
		f.layers = append(f.layers, &l)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read gpkg_contents: %w", err)
	}
	for _, l := range f.layers {
		if err := f.describe(l); err != nil {
			return err
		}
	}
	return nil
}

func (f *File) describe(l *layerInfo) error {
	rows, err := f.db.Query(`SELECT name, type, pk FROM pragma_table_info(?) ORDER BY cid`, l.Name)
	if err != nil {
		return fmt.Errorf("read columns of %s: %w", l.Name, err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var c Column
		var pk int
		if err := rows.Scan(&c.Name, &c.Type, &pk); err != nil {
			return fmt.Errorf("read columns of %s: %w", l.Name, err)
		}
		switch {
		case pk == 1 && strings.EqualFold(c.Type, "INTEGER"):
			l.PrimaryKey = c.Name
		case strings.EqualFold(c.Name, l.GeometryColumn):
		default:
			l.Columns = append(l.Columns, c)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read columns of %s: %w", l.Name, err)
	}
	if l.PrimaryKey == "" && l.Problem == "" {
		l.Problem = "the table has no INTEGER PRIMARY KEY, so its features cannot be named one by one"
	}
	if err := f.db.QueryRow(`SELECT count(*) FROM ` + quote(l.Name)).Scan(&l.FeatureCount); err != nil {
		return fmt.Errorf("count features of %s: %w", l.Name, err)
	}
	rtree := "rtree_" + l.Name + "_" + l.GeometryColumn
	var n int
	if err := f.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, rtree).Scan(&n); err != nil {
		return fmt.Errorf("look for the spatial index of %s: %w", l.Name, err)
	}
	if n == 1 {
		l.rtree = rtree
		l.SpatialIndex = true
	}
	return nil
}

/*
projectionFor returns the conversions between a layer's coordinates and
longitude and latitude.

Geographic systems are read as longitude and latitude without a datum shift.
The GeoPackage standard fixes the axis order of a geometry blob as x then y, so
x is longitude whatever the authority's axis order is. Between SIRGAS 2000
(EPSG:4674), the system IBGE publishes in, and WGS 84, the basemaps' system,
the difference in Brazil is under a metre, which is below the precision of a
CNEFE coordinate and of a screenshot.
*/
func projectionFor(srsID int64, org string, orgID int64, definition string) (Projection, Projection, error) {
	def := strings.ToUpper(strings.TrimSpace(definition))
	switch {
	case srsID == 0:
		return identity, identity, nil
	case srsID == -1:
		return nil, nil, errors.New("the layer's coordinate system is undefined (srs_id -1)")
	case strings.EqualFold(org, "EPSG") && (orgID == 3857 || orgID == 900913),
		strings.EqualFold(org, "ESRI") && orgID == 102100:
		return webMercatorToLonLat, lonLatToWebMercator, nil
	case strings.HasPrefix(def, "GEOGCS"), strings.HasPrefix(def, "GEOGCRS"), strings.HasPrefix(def, "GEODCRS"):
		return identity, identity, nil
	default:
		return nil, nil, fmt.Errorf("the layer is in %s:%d, which this application does not reproject; "+
			"save a copy in EPSG:4326 (in QGIS: Export, Save Features As; or ogr2ogr -t_srs EPSG:4326)", org, orgID)
	}
}

func (f *File) layer(name string) (*layerInfo, error) {
	for _, l := range f.layers {
		if l.Name == name {
			if l.Problem != "" {
				return nil, fmt.Errorf("layer %s cannot be read: %s", name, l.Problem)
			}
			return l, nil
		}
	}
	return nil, fmt.Errorf("the GeoPackage has no feature layer named %q", name)
}

// Layer returns one layer's description.
func (f *File) Layer(name string) (Layer, error) {
	l, err := f.layer(name)
	if err != nil {
		return Layer{}, err
	}
	return l.Layer, nil
}

// Row is one feature: its id, its position and its attribute values in the
// order of the layer's columns.
type Row struct {
	FID int64 `json:"fid"`
	// Position is [longitude, latitude]; nil when the geometry is empty.
	Position *[2]float64 `json:"position"`
	Values   []any       `json:"values"`
}

// Table is every feature of a layer.
type Table struct {
	Layer   string   `json:"layer"`
	Columns []Column `json:"columns"`
	Rows    []Row    `json:"rows"`
}

// MaxTableRows bounds the layers loaded whole. Annotation goes record by
// record, and a layer far past this is a road network or a building
// footprint set, not a list anyone will walk through.
const MaxTableRows = 500_000

func (f *File) selectList(l *layerInfo) string {
	cols := []string{quote(l.PrimaryKey), quote(l.GeometryColumn)}
	for _, c := range l.Columns {
		cols = append(cols, quote(c.Name))
	}
	return strings.Join(cols, ", ")
}

func (f *File) scanRow(l *layerInfo, scanner interface{ Scan(...any) error }) (Row, Decoded, error) {
	var (
		fid  int64
		geom []byte
	)
	raw := make([]any, len(l.Columns))
	dest := make([]any, 0, len(l.Columns)+2)
	dest = append(dest, &fid, &geom)
	for i := range raw {
		dest = append(dest, &raw[i])
	}
	if err := scanner.Scan(dest...); err != nil {
		return Row{}, Decoded{}, err
	}
	row := Row{FID: fid, Values: make([]any, len(raw))}
	for i, v := range raw {
		row.Values[i] = normalize(l.Columns[i], v)
	}
	var d Decoded
	if len(geom) > 0 {
		var err error
		d, err = Decode(geom, l.project)
		if err != nil {
			return Row{}, Decoded{}, fmt.Errorf("feature %d: %w", fid, err)
		}
		row.Position = d.Position()
	}
	return row, d, nil
}

// normalize turns an SQLite value into one JSON can carry and a reader
// expects: BOOLEAN columns hold 0 and 1, and JSON has no NaN.
func normalize(c Column, v any) any {
	switch x := v.(type) {
	case []byte:
		if strings.EqualFold(c.Type, "BLOB") {
			return fmt.Sprintf("(%d bytes)", len(x))
		}
		return string(x)
	case int64:
		if strings.EqualFold(c.Type, "BOOLEAN") {
			return x != 0
		}
		return x
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return nil
		}
		return x
	default:
		return v
	}
}

// Table reads every feature of a layer.
func (f *File) Table(name string) (*Table, error) {
	l, err := f.layer(name)
	if err != nil {
		return nil, err
	}
	if l.FeatureCount > MaxTableRows {
		return nil, fmt.Errorf("layer %s has %d features; annotation loads at most %d", name, l.FeatureCount, MaxTableRows)
	}
	rows, err := f.db.Query(fmt.Sprintf(`SELECT %s FROM %s ORDER BY %s`,
		f.selectList(l), quote(l.Name), quote(l.PrimaryKey)))
	if err != nil {
		return nil, fmt.Errorf("read layer %s: %w", name, err)
	}
	defer func() { _ = rows.Close() }()
	t := &Table{Layer: name, Columns: l.Columns, Rows: make([]Row, 0, l.FeatureCount)}
	for rows.Next() {
		row, _, err := f.scanRow(l, rows)
		if err != nil {
			return nil, fmt.Errorf("read layer %s: %w", name, err)
		}
		t.Rows = append(t.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read layer %s: %w", name, err)
	}
	return t, nil
}

// Feature reads one feature by id.
func (f *File) Feature(name string, fid int64) (Row, error) {
	l, err := f.layer(name)
	if err != nil {
		return Row{}, err
	}
	q := fmt.Sprintf(`SELECT %s FROM %s WHERE %s = ?`, f.selectList(l), quote(l.Name), quote(l.PrimaryKey))
	row, _, err := f.scanRow(l, f.db.QueryRow(q, fid))
	if errors.Is(err, sql.ErrNoRows) {
		return Row{}, fmt.Errorf("layer %s has no feature %d", name, fid)
	}
	if err != nil {
		return Row{}, fmt.Errorf("read feature %d of %s: %w", fid, name, err)
	}
	return row, nil
}

// FilterFIDs returns the ids of the features an SQL condition selects. The
// condition is what follows WHERE, written against the layer's own columns.
// The file is open read-only, so a condition can be slow but cannot change it.
func (f *File) FilterFIDs(name, condition string) ([]int64, error) {
	l, err := f.layer(name)
	if err != nil {
		return nil, err
	}
	condition = strings.TrimSpace(condition)
	if condition == "" {
		return nil, errors.New("the filter is empty")
	}
	if strings.Contains(condition, ";") {
		return nil, errors.New("the filter is one condition and cannot contain ';'")
	}
	rows, err := f.db.Query(fmt.Sprintf(`SELECT %s FROM %s WHERE %s`, quote(l.PrimaryKey), quote(l.Name), condition))
	if err != nil {
		return nil, fmt.Errorf("SQLite refused the filter: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("run the filter: %w", err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("SQLite refused the filter: %w", err)
	}
	return out, nil
}

// Feature is one GeoJSON feature.
type Feature struct {
	Type       string         `json:"type"`
	ID         int64          `json:"id"`
	Geometry   Geometry       `json:"geometry"`
	Properties map[string]any `json:"properties"`
}

// FeatureCollection is a GeoJSON feature collection, with a flag for when
// the limit cut it short.
type FeatureCollection struct {
	Type      string    `json:"type"`
	Features  []Feature `json:"features"`
	Truncated bool      `json:"truncated"`
}

// FeaturesIn returns the features whose bounding box meets bbox, at most
// limit of them. The spatial index is used when the file has one.
func (f *File) FeaturesIn(name string, bbox BBox, limit int) (*FeatureCollection, error) {
	l, err := f.layer(name)
	if err != nil {
		return nil, err
	}
	fc := &FeatureCollection{Type: "FeatureCollection", Features: []Feature{}}
	fc.Truncated, err = f.eachIn(l, bbox, limit, func(row Row, d Decoded) {
		props := make(map[string]any, len(l.Columns))
		for i, c := range l.Columns {
			props[c.Name] = row.Values[i]
		}
		fc.Features = append(fc.Features, Feature{Type: "Feature", ID: row.FID, Geometry: d.Geometry, Properties: props})
	})
	if err != nil {
		return nil, err
	}
	return fc, nil
}

// eachIn calls each for the features of a layer whose bounding box meets
// bbox, at most limit of them, and reports whether the limit cut the set
// short. The spatial index is used when the layer has one.
func (f *File) eachIn(l *layerInfo, bbox BBox, limit int, each func(Row, Decoded)) (bool, error) {
	var (
		rows *sql.Rows
		err  error
	)
	// An unbounded box reads the table: the index would only add a join, and
	// infinities do not survive the conversion to Web Mercator.
	if l.rtree != "" && !math.IsInf(bbox.MinX, 0) && !math.IsInf(bbox.MaxX, 0) {
		minX, minY := l.unproject(bbox.MinX, bbox.MinY)
		maxX, maxY := l.unproject(bbox.MaxX, bbox.MaxY)
		q := fmt.Sprintf(`SELECT %s FROM %s WHERE %s IN (
			SELECT id FROM %s WHERE maxx >= ? AND minx <= ? AND maxy >= ? AND miny <= ?)`,
			f.selectList(l), quote(l.Name), quote(l.PrimaryKey), quote(l.rtree))
		rows, err = f.db.Query(q, minX, maxX, minY, maxY)
	} else {
		rows, err = f.db.Query(fmt.Sprintf(`SELECT %s FROM %s`, f.selectList(l), quote(l.Name)))
	}
	if err != nil {
		return false, fmt.Errorf("read layer %s: %w", l.Name, err)
	}
	defer func() { _ = rows.Close() }()
	n := 0
	for rows.Next() {
		row, d, err := f.scanRow(l, rows)
		if err != nil {
			return false, fmt.Errorf("read layer %s: %w", l.Name, err)
		}
		if d.BBox == nil || !d.BBox.intersects(bbox) {
			continue
		}
		if n == limit {
			return true, nil
		}
		each(row, d)
		n++
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("read layer %s: %w", l.Name, err)
	}
	return false, nil
}

// MaxWholeLayerFeatures bounds the layers sent to the map whole. A larger one,
// such as a road network, is read for the area in view instead.
const MaxWholeLayerFeatures = 50_000

// GeoJSON writes a whole layer as a GeoJSON FeatureCollection. Each feature
// carries its fid as id, which the map needs for per-feature state, and its
// attributes as properties: only the columns named in keep when keep is not
// empty, and never the columns named in omit.
func (f *File) GeoJSON(name string, omit, keep []string) ([]byte, error) {
	l, err := f.layer(name)
	if err != nil {
		return nil, err
	}
	if l.FeatureCount > MaxWholeLayerFeatures {
		return nil, fmt.Errorf("layer %s has %d features; whole layers are sent up to %d", name, l.FeatureCount, MaxWholeLayerFeatures)
	}
	skip := map[string]bool{}
	for _, c := range omit {
		skip[c] = true
	}
	only := map[string]bool{}
	for _, c := range keep {
		only[c] = true
	}
	fc := FeatureCollection{Type: "FeatureCollection", Features: make([]Feature, 0, l.FeatureCount)}
	all := BBox{MinX: math.Inf(-1), MinY: math.Inf(-1), MaxX: math.Inf(1), MaxY: math.Inf(1)}
	if _, err := f.eachIn(l, all, int(l.FeatureCount)+1, func(row Row, d Decoded) {
		props := make(map[string]any, len(l.Columns))
		for i, c := range l.Columns {
			if !skip[c.Name] && (len(only) == 0 || only[c.Name]) {
				props[c.Name] = row.Values[i]
			}
		}
		fc.Features = append(fc.Features, Feature{Type: "Feature", ID: row.FID, Geometry: d.Geometry, Properties: props})
	}); err != nil {
		return nil, err
	}
	b, err := json.Marshal(fc)
	if err != nil {
		return nil, fmt.Errorf("write layer %s as GeoJSON: %w", name, err)
	}
	return b, nil
}
