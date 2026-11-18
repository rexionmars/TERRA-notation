package gpkg

import (
	"errors"
	"math"
	"sort"
)

// meanEarthRadius is the IUGG mean radius of the Earth, in metres.
const meanEarthRadius = 6371008.8

// DistanceMeters is the great-circle distance between two positions given in
// degrees, on a sphere of the mean radius. It is within 0.5 % of the
// distance on the ellipsoid, which is far below what a pasted location and a
// CNEFE coordinate can tell apart.
func DistanceMeters(lon1, lat1, lon2, lat2 float64) float64 {
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	h := math.Pow(math.Sin(dLat/2), 2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Pow(math.Sin(dLon/2), 2)
	return 2 * meanEarthRadius * math.Asin(math.Min(1, math.Sqrt(h)))
}

// Near is a feature found near a point.
type Near struct {
	Layer  string
	Row    Row
	Meters float64
}

const (
	// The first box is 0.005 degrees on each side, about 550 m.
	firstNearestDegrees = 0.005
	// Past about 220 km a "nearest" record no longer locates anything.
	maxNearestDegrees = 2.0
	// Enough features per layer and box that a real register never reaches it.
	nearestPerLayer = 20_000
)

/*
Nearest returns up to limit features of the named layers closest to a point,
nearest first, measured from each feature's position.

It reads a box around the point, through the spatial index when there is one,
and doubles the box until the limit-th feature found is nearer than anything
outside the box can be: a feature outside lies at least the box's half-width
of longitude away. The search stops at maxNearestDegrees with what it has.
*/
func (f *File) Nearest(layers []string, lon, lat float64, limit int) ([]Near, error) {
	if limit <= 0 {
		return nil, errors.New("the number of features to find must be positive")
	}
	infos := make([]*layerInfo, 0, len(layers))
	for _, name := range layers {
		l, err := f.layer(name)
		if err != nil {
			return nil, err
		}
		infos = append(infos, l)
	}
	for r := firstNearestDegrees; ; r *= 2 {
		box := BBox{MinX: lon - r, MinY: lat - r, MaxX: lon + r, MaxY: lat + r}
		var found []Near
		for _, l := range infos {
			_, err := f.eachIn(l, box, nearestPerLayer, func(row Row, _ Decoded) {
				if row.Position == nil {
					return
				}
				found = append(found, Near{
					Layer:  l.Name,
					Row:    row,
					Meters: DistanceMeters(lon, lat, row.Position[0], row.Position[1]),
				})
			})
			if err != nil {
				return nil, err
			}
		}
		sort.SliceStable(found, func(i, j int) bool { return found[i].Meters < found[j].Meters })
		reach := r * math.Pi / 180 * meanEarthRadius * math.Cos(lat*math.Pi/180)
		if len(found) >= limit && found[limit-1].Meters <= reach {
			return found[:limit], nil
		}
		if r >= maxNearestDegrees {
			if len(found) > limit {
				found = found[:limit]
			}
			return found, nil
		}
	}
}
