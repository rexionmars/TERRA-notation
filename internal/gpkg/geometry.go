package gpkg

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// Geometry is a decoded geometry in the shape of a GeoJSON geometry object,
// with positions as [longitude, latitude]. Z and M values are dropped: the
// map and the annotations use the horizontal position only.
type Geometry struct {
	Type        string     `json:"type"`
	Coordinates any        `json:"coordinates,omitempty"`
	Geometries  []Geometry `json:"geometries,omitempty"`
}

// BBox is a bounding box in longitude and latitude.
type BBox struct {
	MinX float64 `json:"min_x"`
	MinY float64 `json:"min_y"`
	MaxX float64 `json:"max_x"`
	MaxY float64 `json:"max_y"`
}

func (b BBox) intersects(o BBox) bool {
	return b.MaxX >= o.MinX && b.MinX <= o.MaxX && b.MaxY >= o.MinY && b.MinY <= o.MaxY
}

// Projection converts a layer's x and y to longitude and latitude.
type Projection func(x, y float64) (lon, lat float64)

func identity(x, y float64) (float64, float64) { return x, y }

const earthRadius = 6378137.0

func webMercatorToLonLat(x, y float64) (float64, float64) {
	lon := x / earthRadius * 180 / math.Pi
	lat := (2*math.Atan(math.Exp(y/earthRadius)) - math.Pi/2) * 180 / math.Pi
	return lon, lat
}

func lonLatToWebMercator(lon, lat float64) (float64, float64) {
	x := lon * math.Pi / 180 * earthRadius
	y := math.Log(math.Tan(math.Pi/4+lat*math.Pi/360)) * earthRadius
	return x, y
}

// Decoded is one geometry read from a GeoPackage blob.
type Decoded struct {
	Geometry Geometry
	// BBox is nil when the geometry is empty.
	BBox *BBox
}

// Position is the point an annotation refers to: the point itself for a
// Point, and the centre of the bounding box for anything else. It is nil when
// the geometry is empty.
func (d Decoded) Position() *[2]float64 {
	if d.BBox == nil {
		return nil
	}
	if p, ok := d.Geometry.Coordinates.([2]float64); ok && d.Geometry.Type == "Point" {
		return &p
	}
	c := [2]float64{(d.BBox.MinX + d.BBox.MaxX) / 2, (d.BBox.MinY + d.BBox.MaxY) / 2}
	return &c
}

var errNotGeoPackageGeometry = errors.New("the value is not a GeoPackage geometry (it does not start with GP)")

// Decode reads a GeoPackage geometry blob: the GP header of the standard
// (OGC 12-128r19, section 2.1.3) followed by ISO WKB.
func Decode(blob []byte, project Projection) (Decoded, error) {
	if len(blob) < 8 || blob[0] != 'G' || blob[1] != 'P' {
		return Decoded{}, errNotGeoPackageGeometry
	}
	flags := blob[3]
	if flags&0x20 != 0 {
		return Decoded{}, errors.New("extended GeoPackage geometry types are not supported")
	}
	var envelopeBytes int
	switch indicator := (flags >> 1) & 0x07; indicator {
	case 0:
	case 1:
		envelopeBytes = 32
	case 2, 3:
		envelopeBytes = 48
	case 4:
		envelopeBytes = 64
	default:
		return Decoded{}, fmt.Errorf("envelope indicator %d is not defined by the GeoPackage standard", indicator)
	}
	offset := 8 + envelopeBytes
	if len(blob) < offset {
		return Decoded{}, errors.New("geometry blob ends inside its header")
	}
	r := wkbReader{b: blob, pos: offset, project: project}
	g, err := r.geometry(0)
	if err != nil {
		return Decoded{}, err
	}
	d := Decoded{Geometry: g}
	if r.seen {
		bb := r.bbox
		d.BBox = &bb
	}
	return d, nil
}

type wkbReader struct {
	b       []byte
	pos     int
	project Projection
	bbox    BBox
	seen    bool
}

// A geometry collection nested deeper than this is taken as a corrupt blob
// rather than followed, so a cycle of bad lengths cannot exhaust the stack.
const maxNesting = 32

func (r *wkbReader) need(n int) error {
	if n < 0 || r.pos+n > len(r.b) {
		return errors.New("geometry blob is shorter than its WKB says")
	}
	return nil
}

func (r *wkbReader) geometry(depth int) (Geometry, error) {
	if depth > maxNesting {
		return Geometry{}, errors.New("geometry nests deeper than any real layer does")
	}
	if err := r.need(5); err != nil {
		return Geometry{}, err
	}
	var order binary.ByteOrder
	switch r.b[r.pos] {
	case 0:
		order = binary.BigEndian
	case 1:
		order = binary.LittleEndian
	default:
		return Geometry{}, fmt.Errorf("WKB byte order %d is neither 0 nor 1", r.b[r.pos])
	}
	code := order.Uint32(r.b[r.pos+1:])
	r.pos += 5

	dims := 2
	// EWKB flags, which some writers use in place of the ISO codes.
	if code&0x80000000 != 0 {
		dims++
	}
	if code&0x40000000 != 0 {
		dims++
	}
	if code&0x20000000 != 0 {
		if err := r.need(4); err != nil {
			return Geometry{}, err
		}
		r.pos += 4
	}
	code &= 0x0FFFFFFF
	switch code / 1000 {
	case 1, 2:
		dims++
	case 3:
		dims += 2
	}

	switch base := code % 1000; base {
	case 1:
		p, ok, err := r.position(order, dims)
		if err != nil {
			return Geometry{}, err
		}
		if !ok {
			return Geometry{Type: "Point", Coordinates: []float64{}}, nil
		}
		return Geometry{Type: "Point", Coordinates: p}, nil
	case 2:
		line, err := r.positions(order, dims)
		return Geometry{Type: "LineString", Coordinates: line}, err
	case 3:
		rings, err := r.rings(order, dims)
		return Geometry{Type: "Polygon", Coordinates: rings}, err
	case 4, 5, 6, 7:
		return r.collection(order, base, depth)
	default:
		return Geometry{}, fmt.Errorf("WKB geometry type %d is not supported", code)
	}
}

func (r *wkbReader) count(order binary.ByteOrder, itemBytes int) (int, error) {
	if err := r.need(4); err != nil {
		return 0, err
	}
	n := int(order.Uint32(r.b[r.pos:]))
	r.pos += 4
	// Every item takes at least itemBytes, so a count the blob cannot hold is
	// refused before anything is allocated for it.
	if n > (len(r.b)-r.pos)/itemBytes {
		return 0, errors.New("geometry blob is shorter than its WKB says")
	}
	return n, nil
}

func (r *wkbReader) position(order binary.ByteOrder, dims int) ([2]float64, bool, error) {
	if err := r.need(8 * dims); err != nil {
		return [2]float64{}, false, err
	}
	x := math.Float64frombits(order.Uint64(r.b[r.pos:]))
	y := math.Float64frombits(order.Uint64(r.b[r.pos+8:]))
	r.pos += 8 * dims
	// An empty point is written as NaN coordinates.
	if math.IsNaN(x) || math.IsNaN(y) {
		return [2]float64{}, false, nil
	}
	lon, lat := r.project(x, y)
	if !r.seen {
		r.bbox = BBox{MinX: lon, MinY: lat, MaxX: lon, MaxY: lat}
		r.seen = true
	} else {
		r.bbox.MinX = math.Min(r.bbox.MinX, lon)
		r.bbox.MinY = math.Min(r.bbox.MinY, lat)
		r.bbox.MaxX = math.Max(r.bbox.MaxX, lon)
		r.bbox.MaxY = math.Max(r.bbox.MaxY, lat)
	}
	return [2]float64{lon, lat}, true, nil
}

func (r *wkbReader) positions(order binary.ByteOrder, dims int) ([][2]float64, error) {
	n, err := r.count(order, 8*dims)
	if err != nil {
		return nil, err
	}
	out := make([][2]float64, 0, n)
	for range n {
		p, ok, err := r.position(order, dims)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, p)
		}
	}
	return out, nil
}

func (r *wkbReader) rings(order binary.ByteOrder, dims int) ([][][2]float64, error) {
	n, err := r.count(order, 4)
	if err != nil {
		return nil, err
	}
	out := make([][][2]float64, 0, n)
	for range n {
		ring, err := r.positions(order, dims)
		if err != nil {
			return nil, err
		}
		out = append(out, ring)
	}
	return out, nil
}

func (r *wkbReader) collection(order binary.ByteOrder, base uint32, depth int) (Geometry, error) {
	n, err := r.count(order, 5)
	if err != nil {
		return Geometry{}, err
	}
	parts := make([]Geometry, 0, n)
	for range n {
		g, err := r.geometry(depth + 1)
		if err != nil {
			return Geometry{}, err
		}
		parts = append(parts, g)
	}
	switch base {
	case 4:
		coords := make([][2]float64, 0, len(parts))
		for _, p := range parts {
			if c, ok := p.Coordinates.([2]float64); ok {
				coords = append(coords, c)
			}
		}
		return Geometry{Type: "MultiPoint", Coordinates: coords}, nil
	case 5:
		coords := make([][][2]float64, 0, len(parts))
		for _, p := range parts {
			if c, ok := p.Coordinates.([][2]float64); ok {
				coords = append(coords, c)
			}
		}
		return Geometry{Type: "MultiLineString", Coordinates: coords}, nil
	case 6:
		coords := make([][][][2]float64, 0, len(parts))
		for _, p := range parts {
			if c, ok := p.Coordinates.([][][2]float64); ok {
				coords = append(coords, c)
			}
		}
		return Geometry{Type: "MultiPolygon", Coordinates: coords}, nil
	default:
		return Geometry{Type: "GeometryCollection", Geometries: parts}, nil
	}
}

// EncodePoint writes a point in EPSG:4326 as a GeoPackage geometry blob:
// little-endian header without envelope, then ISO WKB.
func EncodePoint(lon, lat float64) []byte {
	b := make([]byte, 8+21)
	b[0], b[1], b[2], b[3] = 'G', 'P', 0, 0x01
	binary.LittleEndian.PutUint32(b[4:], 4326)
	b[8] = 1
	binary.LittleEndian.PutUint32(b[9:], 1)
	binary.LittleEndian.PutUint64(b[13:], math.Float64bits(lon))
	binary.LittleEndian.PutUint64(b[21:], math.Float64bits(lat))
	return b
}
