package exports

import (
	"math"
	"strings"
	"testing"

	"terra-point-check/internal/annotation"
)

func near(a, b float64) bool { return math.Abs(a-b) < 5e-4 }

func TestTheWilsonIntervalMatchesItsPublishedValues(t *testing.T) {
	// R 4's prop.test(x, n, correct = FALSE), the Wilson score interval,
	// gives 0.2553 to 0.3662 for 81 of 263 and 0 to 0.2775 for 0 of 10.
	lo, hi := wilson(81, 263)
	if !near(lo, 0.2553) || !near(hi, 0.3662) {
		t.Fatalf("81/263: %.4f to %.4f", lo, hi)
	}
	lo, hi = wilson(0, 10)
	if lo != 0 || !near(hi, 0.2775) {
		t.Fatalf("0/10: %.4f to %.4f", lo, hi)
	}
}

func TestTheStratifiedShareWeightsStrataByPopulation(t *testing.T) {
	strata := []annotation.Stratum{{Value: "paved", Population: 900, Drawn: 10}, {Value: "unpaved", Population: 100, Drawn: 10}}
	// 2 of 10 in the paved stratum, 8 of 10 in the unpaved: 0.9 * 0.2 + 0.1 * 0.8.
	est, lo, hi, note := stratified(strata, map[string]int{"paved": 2, "unpaved": 8},
		map[string]int{"paved": 10, "unpaved": 10})
	if note != "" || !near(est, 0.26) || !(lo < est && est < hi) {
		t.Fatalf("estimate %.4f (%.4f to %.4f), %q", est, lo, hi, note)
	}
	// By hand: 0.81 * (1 - 10/900) * 0.16 / 9 + 0.01 * (1 - 10/100) * 0.16 / 9.
	se := math.Sqrt(0.81*(1-10.0/900)*0.16/9 + 0.01*0.9*0.16/9)
	if !near(hi-est, z95*se) {
		t.Fatalf("half-width %.4f, want %.4f", hi-est, z95*se)
	}
	_, _, _, note = stratified(strata, map[string]int{"paved": 1}, map[string]int{"paved": 1, "unpaved": 10})
	if !strings.Contains(note, "paved") {
		t.Fatalf("a stratum with one answer gave note %q", note)
	}
	// A category no stratum has: the estimate is 0, the interval is not
	// given as 0 to 0.
	est, lo, _, note = stratified(strata, map[string]int{}, map[string]int{"paved": 10, "unpaved": 10})
	if est != 0 || !math.IsNaN(lo) || note == "" {
		t.Fatalf("a share of 0 everywhere gave %.4f from %.4f, %q", est, lo, note)
	}
}

func TestSharesWithoutASampleHaveNoInterval(t *testing.T) {
	cats := []annotation.Category{{ID: "present"}, {ID: "absent"}}
	got := layerShares(nil, nil, cats, map[int64]string{1: "present", 2: "present", 3: "absent", 4: ""})
	if len(got) != 2 || got[0].N != 3 || got[0].Count != 2 || got[0].HasCI || got[0].Method != methodNone {
		t.Fatalf("shares = %+v", got)
	}
}

func TestASimpleSamplesSharesCountOnlyItsAnsweredRecords(t *testing.T) {
	s := &annotation.Sample{Design: annotation.SampleDesign{Layer: "l"}, Strata: []annotation.Stratum{{Population: 100, Drawn: 3}}}
	recs := []annotation.SampleRecord{{FID: 1}, {FID: 2}, {FID: 3}}
	// Record 9 is answered but not in the sample; record 3 is not answered.
	got := layerShares(s, recs, []annotation.Category{{ID: "present"}}, map[int64]string{1: "present", 2: "absent", 9: "present"})
	if got[0].N != 2 || got[0].Count != 1 || !got[0].HasCI || got[0].Method != methodWilson {
		t.Fatalf("shares = %+v", got)
	}
}
