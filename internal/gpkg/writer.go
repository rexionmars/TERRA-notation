package gpkg

import (
	"database/sql"
	"fmt"
	"math"
	"net/url"
	"os"
	"strings"
	"time"
)

// The three rows every GeoPackage must hold in gpkg_spatial_ref_sys
// (OGC 12-128r19, requirement 11), the third being the only system written.
const wgs84Definition = `GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,` +
	`AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],` +
	`UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]`

const metadataSchema = `
PRAGMA application_id = 1196444487;
PRAGMA user_version = 10400;
CREATE TABLE gpkg_spatial_ref_sys (
  srs_name TEXT NOT NULL,
  srs_id INTEGER PRIMARY KEY,
  organization TEXT NOT NULL,
  organization_coordsys_id INTEGER NOT NULL,
  definition TEXT NOT NULL,
  description TEXT
);
CREATE TABLE gpkg_contents (
  table_name TEXT NOT NULL PRIMARY KEY,
  data_type TEXT NOT NULL,
  identifier TEXT UNIQUE,
  description TEXT DEFAULT '',
  last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
  srs_id INTEGER,
  CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
);
CREATE TABLE gpkg_geometry_columns (
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  geometry_type_name TEXT NOT NULL,
  srs_id INTEGER NOT NULL,
  z TINYINT NOT NULL,
  m TINYINT NOT NULL,
  CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
  CONSTRAINT uk_gc_table_name UNIQUE (table_name),
  CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
  CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
);
`

// Writer creates a GeoPackage of point layers in EPSG:4326.
type Writer struct {
	db *sql.DB
}

// Create makes a new GeoPackage at path. It refuses a path that exists.
func Create(path string) (*Writer, error) {
	if _, err := os.Stat(path); err == nil {
		return nil, fmt.Errorf("create geopackage: %s already exists", path)
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=rwc"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("create geopackage: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(metadataSchema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create geopackage metadata: %w", err)
	}
	_, err = db.Exec(`INSERT INTO gpkg_spatial_ref_sys VALUES
		('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system'),
		('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system'),
		('WGS 84 geodetic', 4326, 'EPSG', 4326, ?, 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid')`,
		wgs84Definition)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create geopackage metadata: %w", err)
	}
	return &Writer{db: db}, nil
}

// Close finishes the file.
func (w *Writer) Close() error { return w.db.Close() }

// PointRow is one point to write, with values in the order of the layer's
// columns.
type PointRow struct {
	Lon, Lat float64
	Values   []any
}

// geoPackageTypes are the column types the standard allows (table 1 of
// OGC 12-128r19); anything else is written as TEXT.
var geoPackageTypes = map[string]bool{
	"BOOLEAN": true, "TINYINT": true, "SMALLINT": true, "MEDIUMINT": true, "INT": true,
	"INTEGER": true, "FLOAT": true, "DOUBLE": true, "REAL": true, "TEXT": true,
	"BLOB": true, "DATE": true, "DATETIME": true,
}

func columnType(t string) string {
	u := strings.ToUpper(strings.TrimSpace(t))
	if geoPackageTypes[u] || strings.HasPrefix(u, "TEXT(") || strings.HasPrefix(u, "BLOB(") {
		return u
	}
	return "TEXT"
}

// AddPointLayer writes one layer. Its feature id column is fid and its
// geometry column geom, as GDAL names them.
func (w *Writer) AddPointLayer(name, description string, columns []Column, rows []PointRow) error {
	defs := []string{`"fid" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL`, `"geom" POINT`}
	marks := []string{"?"}
	for _, c := range columns {
		defs = append(defs, quote(c.Name)+" "+columnType(c.Type))
		marks = append(marks, "?")
	}
	tx, err := w.db.Begin()
	if err != nil {
		return fmt.Errorf("write layer %s: %w", name, err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(fmt.Sprintf(`CREATE TABLE %s (%s)`, quote(name), strings.Join(defs, ", "))); err != nil {
		return fmt.Errorf("write layer %s: %w", name, err)
	}
	cols := []string{`"geom"`}
	for _, c := range columns {
		cols = append(cols, quote(c.Name))
	}
	stmt, err := tx.Prepare(fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`,
		quote(name), strings.Join(cols, ", "), strings.Join(marks, ", ")))
	if err != nil {
		return fmt.Errorf("write layer %s: %w", name, err)
	}
	defer func() { _ = stmt.Close() }()
	bb := BBox{MinX: math.Inf(1), MinY: math.Inf(1), MaxX: math.Inf(-1), MaxY: math.Inf(-1)}
	for _, r := range rows {
		if len(r.Values) != len(columns) {
			return fmt.Errorf("write layer %s: a row has %d values for %d columns", name, len(r.Values), len(columns))
		}
		args := append([]any{EncodePoint(r.Lon, r.Lat)}, r.Values...)
		if _, err := stmt.Exec(args...); err != nil {
			return fmt.Errorf("write layer %s: %w", name, err)
		}
		bb.MinX, bb.MinY = math.Min(bb.MinX, r.Lon), math.Min(bb.MinY, r.Lat)
		bb.MaxX, bb.MaxY = math.Max(bb.MaxX, r.Lon), math.Max(bb.MaxY, r.Lat)
	}
	var minX, minY, maxX, maxY any
	if len(rows) > 0 {
		minX, minY, maxX, maxY = bb.MinX, bb.MinY, bb.MaxX, bb.MaxY
	}
	if _, err := tx.Exec(`INSERT INTO gpkg_contents
		(table_name, data_type, identifier, description, last_change, min_x, min_y, max_x, max_y, srs_id)
		VALUES (?, 'features', ?, ?, ?, ?, ?, ?, ?, 4326)`,
		name, name, description, time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), minX, minY, maxX, maxY); err != nil {
		return fmt.Errorf("write layer %s: %w", name, err)
	}
	if _, err := tx.Exec(`INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POINT', 4326, 0, 0)`, name); err != nil {
		return fmt.Errorf("write layer %s: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("write layer %s: %w", name, err)
	}
	return nil
}
