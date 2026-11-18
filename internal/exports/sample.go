package exports

import (
	"fmt"
	"path/filepath"
	"strconv"

	"terra-point-check/internal/annotation"
)

// The status of a sample record at export time.
const (
	statusAnswered   = "answered"
	statusPassedOver = "passed over"
	statusNotReached = "not reached"
)

/*
sampleStatus says, for the records of a sample in their order, which have a
category, which have none although a later record of the sample has one (the
annotator passed over them), and which come after the last answer (not
reached yet). Passed-over records are the ones whose absence can bias an
estimate; not-reached ones only shrink it.
*/
func sampleStatus(recs []annotation.SampleRecord, category map[int64]string) []string {
	out := make([]string, len(recs))
	last := -1
	for i, r := range recs {
		if category[r.FID] != "" {
			last = i
		}
	}
	for i, r := range recs {
		switch {
		case category[r.FID] != "":
			out[i] = statusAnswered
		case i < last:
			out[i] = statusPassedOver
		default:
			out[i] = statusNotReached
		}
	}
	return out
}

// categories reads the current category of every answered record of a layer.
func categories(p *annotation.Project, layer string) (map[int64]string, error) {
	anns, err := p.Annotations(layer)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(anns))
	for _, a := range anns {
		out[a.FID] = a.Category
	}
	return out, nil
}

func optional(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

/*
writeSamples writes samples.csv (each sample's design, one row per sample,
replaced ones included), sample_strata.csv (each stratum's size and the
number drawn) and sample_<id>.csv (the records of each sample in their order,
with their stratum, status and category).
*/
func writeSamples(dir string, p *annotation.Project, labels map[string]string) ([]string, error) {
	samples, err := p.Samples()
	if err != nil || len(samples) == 0 {
		return nil, err
	}
	var files []string
	var designRows, strataRows [][]string
	for _, s := range samples {
		d := s.Design
		origin := ""
		if d.Origin != nil {
			origin = fmt.Sprintf("%s (%s)", d.Origin.Name, d.Origin.Dir)
		}
		designRows = append(designRows, []string{strconv.FormatInt(s.ID, 10), d.Layer, string(d.Kind), s.CreatedAt,
			optional(s.SupersededAt), strconv.FormatInt(s.Seed, 10), d.Condition, d.StratumColumn,
			string(d.Allocation), strconv.Itoa(d.Size), strconv.Itoa(d.PerStratum), strconv.Itoa(s.Population),
			strconv.Itoa(s.AnswersBefore), origin})
		for _, st := range s.Strata {
			strataRows = append(strataRows, []string{strconv.FormatInt(s.ID, 10), d.Layer, st.Value,
				strconv.Itoa(st.Population), strconv.Itoa(st.Drawn)})
		}
		recs, err := p.SampleRecords(s.ID)
		if err != nil {
			return nil, err
		}
		cats, err := categories(p, d.Layer)
		if err != nil {
			return nil, err
		}
		status := sampleStatus(recs, cats)
		var rows [][]string
		for i, r := range recs {
			c := cats[r.FID]
			rows = append(rows, []string{strconv.FormatInt(s.ID, 10), d.Layer, strconv.FormatInt(r.FID, 10),
				r.Stratum, strconv.Itoa(r.Order), status[i], c, labels[c]})
		}
		f := filepath.Join(dir, fmt.Sprintf("sample_%d.csv", s.ID))
		if err := writeCSV(f, []string{"sample_id", "layer", "fid", "stratum", "sample_order", "status",
			"category", "category_label"}, rows); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	f := filepath.Join(dir, "samples.csv")
	if err := writeCSV(f, []string{"sample_id", "layer", "kind", "drawn_at", "superseded_at", "seed", "condition",
		"stratum_column", "allocation", "size", "per_stratum", "population", "answers_before",
		"second_reading_of"}, designRows); err != nil {
		return nil, err
	}
	g := filepath.Join(dir, "sample_strata.csv")
	if err := writeCSV(g, []string{"sample_id", "layer", "stratum", "population", "drawn"}, strataRows); err != nil {
		return nil, err
	}
	return append([]string{f, g}, files...), nil
}
