package exports

import (
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strconv"

	"terra-point-check/internal/annotation"
)

// z95 is the standard normal quantile for a two-sided 95 % interval.
const z95 = 1.959963984540054

// The methods an interval is computed with.
const (
	methodWilson     = "Wilson score, 95 %, without finite population correction"
	methodStratified = "stratified estimator (strata weighted by population), normal 95 % interval with finite population correction"
	methodNone       = "no interval: the records were not drawn as a sample before annotation"
)

// share is one category's share over a set of answered records.
type share struct {
	Stratum   string
	All       bool // over the whole population rather than one stratum
	Category  string
	Count     int
	N         int
	Share     float64
	Low, High float64
	HasCI     bool
	Method    string
	Note      string
}

/*
wilson is the Wilson score interval for x successes in n trials. It stays
inside [0, 1], and with 0 or n successes it does not shrink to a point as
p ± z·se does (0 of 10 gives 0 to 0.2775).
Newcombe (1998), "Two-sided confidence intervals for the single proportion:
comparison of seven methods", Statistics in Medicine 17:857-872, compares it
with the others.
*/
func wilson(x, n int) (low, high float64) {
	if n == 0 {
		return math.NaN(), math.NaN()
	}
	p := float64(x) / float64(n)
	nn := float64(n)
	z2 := z95 * z95
	den := 1 + z2/nn
	centre := (p + z2/(2*nn)) / den
	half := z95 * math.Sqrt(p*(1-p)/nn+z2/(4*nn*nn)) / den
	return math.Max(0, centre-half), math.Min(1, centre+half)
}

/*
stratified is the share of a category over a population cut into strata, the
stratified estimator of a proportion: sum_h W_h p_h, W_h = N_h / N, with
variance sum_h W_h^2 (1 - n_h/N_h) p_h (1 - p_h) / (n_h - 1). It needs two
answers in every stratum: with one, the term is undefined, and a stratum
without answers leaves its weight unestimated.
*/
func stratified(strata []annotation.Stratum, count, n map[string]int) (est, low, high float64, note string) {
	total := 0
	for _, s := range strata {
		total += s.Population
	}
	var v float64
	for _, s := range strata {
		nh := n[s.Value]
		if nh < 2 {
			answers := fmt.Sprintf("%d answers", nh)
			if nh == 1 {
				answers = "one answer"
			}
			return math.NaN(), math.NaN(), math.NaN(),
				fmt.Sprintf("not computed: stratum %q has %s, and the estimate needs two in each", s.Value, answers)
		}
		w := float64(s.Population) / float64(total)
		p := float64(count[s.Value]) / float64(nh)
		est += w * p
		fpc := 1 - float64(nh)/float64(s.Population)
		v += w * w * fpc * p * (1 - p) / float64(nh-1)
	}
	if v == 0 {
		// Every stratum's share is 0 or 1: the normal interval has no width
		// there, and a zero-width interval would claim a certainty the
		// sample does not give. The strata's own intervals give the range.
		return est, math.NaN(), math.NaN(),
			"not computed: every stratum's share is 0 or 1, where the normal interval has no width (the strata's Wilson intervals give the range)"
	}
	se := math.Sqrt(v)
	return est, math.Max(0, est-z95*se), math.Min(1, est+z95*se), ""
}

/*
layerShares computes the share of every category of the project in a layer.
With a current sample: over its answered records, per stratum (Wilson) and
for the whole population (Wilson for a simple sample, the stratified
estimator for a stratified one). Without one: over the answered records,
without an interval.
*/
func layerShares(sample *annotation.Sample, recs []annotation.SampleRecord, cats []annotation.Category,
	category map[int64]string) []share {
	var out []share
	if sample == nil {
		count := map[string]int{}
		n := 0
		for _, c := range category {
			if c != "" {
				count[c]++
				n++
			}
		}
		for _, c := range cats {
			out = append(out, share{All: true, Category: c.ID, Count: count[c.ID], N: n,
				Share: ratio(count[c.ID], n), Method: methodNone})
		}
		return out
	}
	count := map[string]map[string]int{} // stratum → category → records
	n := map[string]int{}
	for _, r := range recs {
		c := category[r.FID]
		if c == "" {
			continue
		}
		if count[r.Stratum] == nil {
			count[r.Stratum] = map[string]int{}
		}
		count[r.Stratum][c]++
		n[r.Stratum]++
	}
	simple := sample.Design.StratumColumn == ""
	for _, c := range cats {
		if simple {
			x, m := count[""][c.ID], n[""]
			lo, hi := wilson(x, m)
			out = append(out, share{All: true, Category: c.ID, Count: x, N: m, Share: ratio(x, m),
				Low: lo, High: hi, HasCI: m > 0, Method: methodWilson})
			continue
		}
		byStratum := map[string]int{}
		total, answered := 0, 0
		for _, s := range sample.Strata {
			byStratum[s.Value] = count[s.Value][c.ID]
			total += count[s.Value][c.ID]
			answered += n[s.Value]
		}
		est, lo, hi, note := stratified(sample.Strata, byStratum, n)
		out = append(out, share{All: true, Category: c.ID, Count: total, N: answered, Share: est,
			Low: lo, High: hi, HasCI: note == "", Method: methodStratified, Note: note})
	}
	if !simple {
		strata := append([]annotation.Stratum(nil), sample.Strata...)
		sort.SliceStable(strata, func(i, j int) bool { return strata[i].Value < strata[j].Value })
		for _, s := range strata {
			for _, c := range cats {
				x, m := count[s.Value][c.ID], n[s.Value]
				lo, hi := wilson(x, m)
				out = append(out, share{Stratum: s.Value, Category: c.ID, Count: x, N: m, Share: ratio(x, m),
					Low: lo, High: hi, HasCI: m > 0, Method: methodWilson})
			}
		}
	}
	return out
}

func ratio(x, n int) float64 {
	if n == 0 {
		return math.NaN()
	}
	return float64(x) / float64(n)
}

func decimalCell(f float64, ok bool) string {
	if !ok || math.IsNaN(f) {
		return ""
	}
	return strconv.FormatFloat(f, 'f', 4, 64)
}

// writeEstimates writes estimates_<layer>.csv: each category's share, its
// interval and how it was computed, for the population and each stratum.
func writeEstimates(dir, layer string, sampleID *int64, shares []share, labels map[string]string) (string, error) {
	id := ""
	if sampleID != nil {
		id = strconv.FormatInt(*sampleID, 10)
	}
	var rows [][]string
	for _, s := range shares {
		stratum := s.Stratum
		if s.All {
			stratum = "(all)"
		}
		rows = append(rows, []string{layer, id, stratum, s.Category, labels[s.Category], strconv.Itoa(s.N),
			strconv.Itoa(s.Count), decimalCell(s.Share, true), decimalCell(s.Low, s.HasCI),
			decimalCell(s.High, s.HasCI), s.Method, s.Note})
	}
	f := filepath.Join(dir, "estimates_"+layer+".csv")
	return f, writeCSV(f, []string{"layer", "sample_id", "stratum", "category", "category_label", "answered",
		"count", "share", "ci95_low", "ci95_high", "method", "note"}, rows)
}
