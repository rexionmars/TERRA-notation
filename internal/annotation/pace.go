package annotation

import (
	"fmt"
	"sort"
	"time"
)

// Pace is how long a first answer takes, from the history.
type Pace struct {
	// Timed counts the records whose first answer has an opening time.
	Timed int `json:"timed"`
	// MedianSeconds is the median time from opening a record to the save
	// that first gave it a category; 0 when nothing is timed.
	MedianSeconds float64 `json:"median_seconds"`
}

/*
LayerPace measures the time from opening a record to the save that first gave
it a category, over the records of a layer whose history has that opening
time. The median, because a record left open over a break is one long time,
not a slow annotator.
*/
func (p *Project) LayerPace(layer string) (Pace, error) {
	rows, err := p.db.Query(`SELECT fid, opened_at, saved_at FROM annotation_history
		WHERE layer = ? AND category <> '' ORDER BY id`, layer)
	if err != nil {
		return Pace{}, fmt.Errorf("measure the pace of %s: %w", layer, err)
	}
	defer func() { _ = rows.Close() }()
	seen := map[int64]bool{}
	var secs []float64
	for rows.Next() {
		var fid int64
		var opened *string
		var saved string
		if err := rows.Scan(&fid, &opened, &saved); err != nil {
			return Pace{}, fmt.Errorf("measure the pace of %s: %w", layer, err)
		}
		if seen[fid] {
			continue
		}
		seen[fid] = true
		if opened == nil {
			continue
		}
		o, err1 := time.Parse(time.RFC3339, *opened)
		s, err2 := time.Parse(time.RFC3339, saved)
		if err1 != nil || err2 != nil || s.Before(o) {
			continue
		}
		secs = append(secs, s.Sub(o).Seconds())
	}
	if err := rows.Err(); err != nil {
		return Pace{}, fmt.Errorf("measure the pace of %s: %w", layer, err)
	}
	out := Pace{Timed: len(secs)}
	if len(secs) > 0 {
		sort.Float64s(secs)
		m := len(secs) / 2
		out.MedianSeconds = secs[m]
		if len(secs)%2 == 0 {
			out.MedianSeconds = (secs[m-1] + secs[m]) / 2
		}
	}
	return out, nil
}
