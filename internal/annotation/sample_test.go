package annotation

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

func TestTheSeededOrderIsTheRecordListsOrder(t *testing.T) {
	// The same vectors guard lib/recordList.ts (recordList.test.ts).
	ids := make([]int64, 20)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	cases := []struct {
		fids []int64
		seed int64
		want []int64
	}{
		{ids, 48213, []int64{1, 20, 16, 9, 12, 10, 6, 8, 3, 4, 13, 5, 18, 17, 14, 19, 2, 11, 15, 7}},
		{[]int64{5, 3, 100, 42, 8, 1}, 7, []int64{42, 3, 5, 8, 100, 1}},
		{[]int64{10, 20, 30, 40}, 0, []int64{40, 30, 10, 20}},
	}
	for _, c := range cases {
		if got := SeededOrder(c.fids, c.seed); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("seed %d: %v, want %v", c.seed, got, c.want)
		}
	}
}

// layerOf builds a layer of n records whose stratum is "a" for the first
// na and "b" for the rest.
func layerOf(n, na int) ([]int64, []Member) {
	fids := make([]int64, n)
	pop := make([]Member, n)
	for i := range fids {
		fids[i] = int64(i + 1)
		s := "b"
		if i < na {
			s = "a"
		}
		pop[i] = Member{FID: fids[i], Stratum: s}
	}
	return fids, pop
}

func TestASimpleSampleIsTheFirstRecordsOfThePopulationInTheRandomOrder(t *testing.T) {
	fids, pop := layerOf(20, 10)
	// The population is the even ids; the sample is the first five of them
	// in seed 48213's order.
	var even []Member
	for _, m := range pop {
		if m.FID%2 == 0 {
			even = append(even, m)
		}
	}
	recs, strata, err := drawSample(SampleDesign{Layer: "l", Size: 5}, fids, even, 48213)
	if err != nil {
		t.Fatal(err)
	}
	var got []int64
	for i, r := range recs {
		got = append(got, r.FID)
		if r.Order != i+1 {
			t.Fatalf("record %d has order %d", r.FID, r.Order)
		}
	}
	if want := []int64{20, 16, 12, 10, 6}; !reflect.DeepEqual(got, want) {
		t.Fatalf("sample = %v, want %v", got, want)
	}
	if len(strata) != 1 || strata[0].Population != 10 || strata[0].Drawn != 5 {
		t.Fatalf("strata = %+v", strata)
	}
}

func TestAnEqualAllocationTakesTheSameNumberFromEachStratumOrAllOfASmallOne(t *testing.T) {
	fids, pop := layerOf(20, 3)
	recs, strata, err := drawSample(SampleDesign{Layer: "l", StratumColumn: "s", Allocation: AllocationEqual,
		PerStratum: 5}, fids, pop, 48213)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 8 || strata[0].Value != "a" || strata[0].Drawn != 3 || strata[1].Drawn != 5 {
		t.Fatalf("records %d, strata %+v", len(recs), strata)
	}
}

func TestAProportionalAllocationSharesTheSizeByLargestRemainder(t *testing.T) {
	q, err := quotas(SampleDesign{StratumColumn: "s", Allocation: AllocationProportional, Size: 10},
		[]int{50, 30, 20, 1})
	if err != nil {
		t.Fatal(err)
	}
	// Exact shares 4.95, 2.97, 1.98, 0.099: floors 4, 2, 1, 0 and three
	// more to the largest remainders.
	if want := []int{5, 3, 2, 0}; !reflect.DeepEqual(q, want) {
		t.Fatalf("quotas = %v, want %v", q, want)
	}
}

func TestADrawnSampleIsFixedAndAReplacedOneIsKept(t *testing.T) {
	p, _ := newProject(t)
	fids, pop := layerOf(30, 10)
	if _, err := p.Save(Draft{Layer: "schools", FID: 4, Category: "present"}, Snapshot{}); err != nil {
		t.Fatal(err)
	}
	d := SampleDesign{Layer: "schools", Size: 6}
	first, err := p.DrawSample(d, fids, pop, false)
	if err != nil {
		t.Fatal(err)
	}
	if first.AnswersBefore != 1 || first.Population != 30 || first.Design.Kind != KindSample {
		t.Fatalf("sample = %+v", first)
	}
	if _, err := p.DrawSample(d, fids, pop, false); err == nil {
		t.Fatal("a second sample replaced the first without being asked to")
	}
	second, err := p.DrawSample(SampleDesign{Layer: "schools", Size: 4}, fids, pop, true)
	if err != nil {
		t.Fatal(err)
	}
	cur, err := p.CurrentSample("schools")
	if err != nil || cur.ID != second.ID {
		t.Fatalf("current = %+v, %v", cur, err)
	}
	all, err := p.Samples()
	if err != nil || len(all) != 2 || all[0].SupersededAt == nil {
		t.Fatalf("samples = %+v, %v", all, err)
	}
	if recs, err := p.SampleRecords(first.ID); err != nil || len(recs) != 6 {
		t.Fatalf("the replaced sample kept %d records, %v", len(recs), err)
	}
	for _, q := range []string{
		`DELETE FROM sample_record`, `UPDATE sample_record SET fid = 99`, `DELETE FROM sample`,
		`UPDATE sample SET design = '{}'`, fmt.Sprintf(`UPDATE sample SET superseded_at = 'x' WHERE id = %d`, first.ID),
	} {
		if _, err := p.db.Exec(q); err == nil {
			t.Fatalf("%s went through", q)
		}
	}
}

func TestTheSeedCannotChangeOnceASampleIsDrawn(t *testing.T) {
	p, _ := newProject(t)
	s, _ := p.Settings()
	s.Seed++
	if err := p.UpdateSettings(s); err != nil {
		t.Fatalf("the seed could not change before a sample: %v", err)
	}
	fids, pop := layerOf(5, 5)
	if _, err := p.DrawSample(SampleDesign{Layer: "schools", Size: 2}, fids, pop, false); err != nil {
		t.Fatal(err)
	}
	s.Seed++
	if err := p.UpdateSettings(s); err == nil {
		t.Fatal("the seed changed after a sample was drawn")
	}
}

func TestThePaceIsTheMedianTimeToAFirstAnswer(t *testing.T) {
	p, _ := newProject(t)
	// Opened 30 s, 60 s and 10 min before the first save with a category;
	// a later revision of the first record does not count again.
	for i, ago := range []time.Duration{30 * time.Second, 60 * time.Second, 10 * time.Minute} {
		opened := time.Now().UTC().Add(-ago).Format(time.RFC3339)
		d := Draft{Layer: "schools", FID: int64(i + 1), Category: "present", OpenedAt: opened}
		if _, err := p.Save(d, Snapshot{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.Save(Draft{Layer: "schools", FID: 1, Category: "absent",
		OpenedAt: time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)}, Snapshot{}); err != nil {
		t.Fatal(err)
	}
	pace, err := p.LayerPace("schools")
	if err != nil {
		t.Fatal(err)
	}
	if pace.Timed != 3 || pace.MedianSeconds < 59 || pace.MedianSeconds > 62 {
		t.Fatalf("pace = %+v", pace)
	}
}
