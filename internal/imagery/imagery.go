/*
Package imagery reads what Esri publishes about the imagery of its World
Imagery basemap at a point: for each source drawn there, the date it was taken,
the sensor, the resolution, the provider and the map levels it is shown at.

A judgement of "what is at the point now" rests on the date of the imagery,
and the basemap itself does not show it. Esri keeps it in the Citations layer
(id 4) of the same MapServer the tiles come from; at Humaitá, AM, in November
2026 it gave WorldView-3 at 0.31 m from 2025-04-14 for levels 12 to 17.
*/
package imagery

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
)

// CitationsURL is the query endpoint of World Imagery's Citations layer.
const CitationsURL = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/4/query"

// Source is one imagery source Esri draws at a point.
type Source struct {
	// Date is YYYY-MM-DD, or "" when Esri gives none (its coarse global
	// mosaics have no single date).
	Date string `json:"date"`
	// Sensor is Esri's short name for it, such as WV03 (WorldView-3).
	Sensor string `json:"sensor"`
	// Product is the collection the tiles belong to, such as Vivid.
	Product string `json:"product"`
	// Provider is who took or sells the imagery, such as Vantor.
	Provider string `json:"provider"`
	// ResolutionM is the ground sample distance in metres.
	ResolutionM float64 `json:"resolution_m"`
	// AccuracyM is Esri's stated horizontal accuracy in metres.
	AccuracyM float64 `json:"accuracy_m"`
	// MinLevel and MaxLevel are the tile levels (256 px tiles) the source is
	// drawn at.
	MinLevel int `json:"min_level"`
	MaxLevel int `json:"max_level"`
}

type queryAnswer struct {
	Features []struct {
		Attributes struct {
			SrcDate     *int64   `json:"SRC_DATE"`
			SrcRes      *float64 `json:"SRC_RES"`
			SrcAcc      *float64 `json:"SRC_ACC"`
			SrcDesc     *string  `json:"SRC_DESC"`
			NiceName    *string  `json:"NICE_NAME"`
			NiceDesc    *string  `json:"NICE_DESC"`
			MinMapLevel *int     `json:"MinMapLevel"`
			MaxMapLevel *int     `json:"MaxMapLevel"`
		} `json:"attributes"`
	} `json:"features"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func text(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func number(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

// date turns Esri's YYYYMMDD integer into YYYY-MM-DD; anything else is no
// date rather than a wrong one.
func date(n *int64) string {
	if n == nil || *n < 1000_01_01 || *n > 9999_12_31 {
		return ""
	}
	v := *n
	y, m, d := v/10000, v/100%100, v%100
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return ""
	}
	return fmt.Sprintf("%04d-%02d-%02d", y, m, d)
}

/*
At asks endpoint (CitationsURL outside tests) for the sources drawn at a point,
finest levels first. The request carries the point's coordinates, as a tile
request carries the area in view.
*/
func At(ctx context.Context, client *http.Client, endpoint string, lon, lat float64) ([]Source, error) {
	q := url.Values{
		"geometry":       {strconv.FormatFloat(lon, 'f', -1, 64) + "," + strconv.FormatFloat(lat, 'f', -1, 64)},
		"geometryType":   {"esriGeometryPoint"},
		"inSR":           {"4326"},
		"spatialRel":     {"esriSpatialRelIntersects"},
		"outFields":      {"SRC_DATE,SRC_RES,SRC_ACC,SRC_DESC,NICE_NAME,NICE_DESC,MinMapLevel,MaxMapLevel"},
		"returnGeometry": {"false"},
		"f":              {"json"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("ask Esri for the imagery dates: %w", err)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ask Esri for the imagery dates: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ask Esri for the imagery dates: the server answered %s", res.Status)
	}
	var a queryAnswer
	if err := json.NewDecoder(res.Body).Decode(&a); err != nil {
		return nil, fmt.Errorf("read Esri's imagery dates: %w", err)
	}
	if a.Error != nil {
		return nil, fmt.Errorf("the imagery query was refused by Esri: %s (code %d)", a.Error.Message, a.Error.Code)
	}
	out := make([]Source, 0, len(a.Features))
	for _, f := range a.Features {
		at := f.Attributes
		if at.MinMapLevel == nil || at.MaxMapLevel == nil {
			continue
		}
		out = append(out, Source{
			Date: date(at.SrcDate), Sensor: text(at.SrcDesc), Product: text(at.NiceName),
			Provider: text(at.NiceDesc), ResolutionM: number(at.SrcRes), AccuracyM: number(at.SrcAcc),
			MinLevel: *at.MinMapLevel, MaxLevel: *at.MaxMapLevel,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MaxLevel > out[j].MaxLevel })
	return out, nil
}
