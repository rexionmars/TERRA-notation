package annotation

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

/*
A sample is the set of records of a layer to be annotated, drawn before the
annotation and kept unchanged after: the records that make a share of
categories an estimate of the layer's, with an interval, rather than a count
of whatever was looked at.

The draw follows the record list's random order (lib/recordList.ts): the
permutation of every feature id of the layer from the project's seed. A
simple sample is the first n records of the population in that order; a
stratified one takes the first n_h of each stratum. Read in that order, the
sample is the list's random order restricted to it.
*/

// Allocation says how a stratified sample shares its records among strata.
type Allocation string

// The allocations.
const (
	// AllocationEqual draws PerStratum records from every stratum.
	AllocationEqual Allocation = "equal"
	// AllocationProportional shares Size records in proportion to the
	// strata's sizes, by largest remainder.
	AllocationProportional Allocation = "proportional"
)

// SampleKind tells a sample drawn in a project from the records a second
// reading project was made with.
type SampleKind string

// The kinds of sample.
const (
	KindSample        SampleKind = "sample"
	KindSecondReading SampleKind = "second_reading"
)

// MaxStrata bounds the strata of one sample. A column with more distinct
// values is an identifier or a measurement, not a grouping.
const MaxStrata = 100

// Origin names the project a second reading was made from.
type Origin struct {
	Dir       string `json:"dir"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	Annotator string `json:"annotator"`
	SampleID  *int64 `json:"sample_id"`
}

// SampleDesign is what is chosen before a sample is drawn.
type SampleDesign struct {
	Layer string     `json:"layer"`
	Kind  SampleKind `json:"kind"`
	// Condition is an SQL condition on the layer's columns that defines the
	// population; empty for every record of the layer.
	Condition string `json:"condition"`
	// StratumColumn groups the population; empty for a simple sample.
	StratumColumn string     `json:"stratum_column"`
	Allocation    Allocation `json:"allocation"`
	// Size is the number of records of a simple or proportional sample.
	Size int `json:"size"`
	// PerStratum is the number of records drawn from each stratum under an
	// equal allocation.
	PerStratum int `json:"per_stratum"`
	// Origin is set for the records of a second reading.
	Origin *Origin `json:"origin,omitempty"`
}

// Stratum is one group of the population and what was drawn from it.
type Stratum struct {
	// Value is the column's value as text; "" for an empty or NULL value.
	Value      string `json:"value"`
	Population int    `json:"population"`
	Drawn      int    `json:"drawn"`
}

// Sample is a drawn sample.
type Sample struct {
	ID         int64        `json:"id"`
	Design     SampleDesign `json:"design"`
	Seed       int64        `json:"seed"`
	Population int          `json:"population"`
	Strata     []Stratum    `json:"strata"`
	CreatedAt  string       `json:"created_at"`
	// AnswersBefore counts the records of the layer that had a category
	// when the sample was drawn: answers seen before the design was fixed.
	AnswersBefore int `json:"answers_before"`
	// SupersededAt is set when another sample of the layer replaced it.
	SupersededAt *string `json:"superseded_at"`
}

// SampleRecord is one record of a sample.
type SampleRecord struct {
	FID     int64
	Stratum string
	// Order is the record's place in the sample, from 1, in the list's
	// random order.
	Order int
}

// Member is one record of the population, with its stratum.
type Member struct {
	FID     int64
	Stratum string
}

// mulberry32 is the generator of lib/recordList.ts, step for step, so the
// same seed orders the same ids the same way in the page and here.
func mulberry32(seed int64) func() float64 {
	a := uint32(seed)
	return func() float64 {
		a += 0x6d2b79f5
		t := a
		t = (t ^ (t >> 15)) * (t | 1)
		t ^= t + (t^(t>>7))*(t|61)
		return float64(t^(t>>14)) / 4294967296
	}
}

// SeededOrder is seededOrder of lib/recordList.ts: the ids sorted, then
// shuffled by Fisher–Yates with mulberry32 from the seed.
func SeededOrder(fids []int64, seed int64) []int64 {
	out := append([]int64(nil), fids...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	next := mulberry32(seed)
	for i := len(out) - 1; i > 0; i-- {
		j := int(math.Floor(next() * float64(i+1)))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// quotas says how many records to draw from each stratum, in the order of
// strata given.
func quotas(d SampleDesign, sizes []int) ([]int, error) {
	out := make([]int, len(sizes))
	total := 0
	for _, n := range sizes {
		total += n
	}
	switch {
	case d.StratumColumn == "":
		if d.Size < 1 {
			return nil, errors.New("a sample needs at least one record")
		}
		out[0] = min(d.Size, total)
	case d.Allocation == AllocationEqual:
		if d.PerStratum < 1 {
			return nil, errors.New("give the number of records to draw from each stratum")
		}
		for i, n := range sizes {
			out[i] = min(d.PerStratum, n)
		}
	case d.Allocation == AllocationProportional:
		if d.Size < 1 {
			return nil, errors.New("a sample needs at least one record")
		}
		if d.Size >= total {
			copy(out, sizes)
			break
		}
		type rest struct {
			i    int
			frac float64
		}
		var rests []rest
		given := 0
		for i, n := range sizes {
			exact := float64(d.Size) * float64(n) / float64(total)
			out[i] = int(math.Floor(exact))
			given += out[i]
			rests = append(rests, rest{i, exact - float64(out[i])})
		}
		// Largest remainder first; a tie goes to the stratum listed first.
		sort.SliceStable(rests, func(a, b int) bool { return rests[a].frac > rests[b].frac })
		for k := 0; given < d.Size; k++ {
			out[rests[k].i]++
			given++
		}
	default:
		return nil, fmt.Errorf("allocation %q is not equal or proportional", d.Allocation)
	}
	return out, nil
}

/*
drawSample draws from population (the records the condition keeps, each with
its stratum) in the order layerFIDs takes under the seed. layerFIDs is every
feature id of the layer, so the order is the record list's.
*/
func drawSample(d SampleDesign, layerFIDs []int64, population []Member, seed int64) ([]SampleRecord, []Stratum, error) {
	if len(population) == 0 {
		return nil, nil, errors.New("no record of the layer meets the condition")
	}
	stratumOf := make(map[int64]string, len(population))
	sizes := map[string]int{}
	for _, m := range population {
		s := m.Stratum
		if d.StratumColumn == "" {
			s = ""
		}
		stratumOf[m.FID] = s
		sizes[s]++
	}
	values := make([]string, 0, len(sizes))
	for v := range sizes {
		values = append(values, v)
	}
	sort.Strings(values)
	if len(values) > MaxStrata {
		return nil, nil, fmt.Errorf("column %s has %d values in the population; a stratum column has at most %d",
			d.StratumColumn, len(values), MaxStrata)
	}
	n := make([]int, len(values))
	for i, v := range values {
		n[i] = sizes[v]
	}
	q, err := quotas(d, n)
	if err != nil {
		return nil, nil, err
	}
	want := map[string]int{}
	for i, v := range values {
		want[v] = q[i]
	}
	var records []SampleRecord
	for _, fid := range SeededOrder(layerFIDs, seed) {
		s, ok := stratumOf[fid]
		if !ok || want[s] == 0 {
			continue
		}
		want[s]--
		records = append(records, SampleRecord{FID: fid, Stratum: s, Order: len(records) + 1})
	}
	strata := make([]Stratum, len(values))
	for i, v := range values {
		strata[i] = Stratum{Value: v, Population: n[i], Drawn: q[i]}
	}
	return records, strata, nil
}

// PreviewSample says what a design would draw, without keeping anything.
func (p *Project) PreviewSample(d SampleDesign, layerFIDs []int64, population []Member) (*Sample, error) {
	settings, err := p.Settings()
	if err != nil {
		return nil, err
	}
	_, strata, err := drawSample(d, layerFIDs, population, settings.Seed)
	if err != nil {
		return nil, err
	}
	return &Sample{Design: d, Seed: settings.Seed, Population: len(population), Strata: strata}, nil
}

/*
DrawSample draws a sample and fixes it. A layer has one current sample; a new
one replaces it only when replace is true, and the one replaced keeps its rows
with the time it stopped being current.
*/
func (p *Project) DrawSample(d SampleDesign, layerFIDs []int64, population []Member, replace bool) (*Sample, error) {
	d.Condition = strings.TrimSpace(d.Condition)
	if d.Kind == "" {
		d.Kind = KindSample
	}
	settings, err := p.Settings()
	if err != nil {
		return nil, err
	}
	records, strata, err := drawSample(d, layerFIDs, population, settings.Seed)
	if err != nil {
		return nil, err
	}
	id, err := p.keepSample(d, settings.Seed, len(population), strata, records, replace)
	if err != nil {
		return nil, err
	}
	return p.sampleByID(id)
}

// keepSample writes a drawn sample, replacing the layer's current one when
// replace is true.
func (p *Project) keepSample(d SampleDesign, seed int64, population int, strata []Stratum, records []SampleRecord,
	replace bool) (int64, error) {
	tx, err := p.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("draw the sample: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var current sql.NullInt64
	if err := tx.QueryRow(`SELECT id FROM sample WHERE layer = ? AND superseded_at IS NULL`, d.Layer).
		Scan(&current); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("draw the sample: %w", err)
	}
	t := now()
	if current.Valid {
		if !replace {
			return 0, fmt.Errorf("layer %s already has a sample; replacing it keeps the old one but needs confirming", d.Layer)
		}
		if _, err := tx.Exec(`UPDATE sample SET superseded_at = ? WHERE id = ?`, t, current.Int64); err != nil {
			return 0, fmt.Errorf("draw the sample: %w", err)
		}
	}
	var before int
	if err := tx.QueryRow(`SELECT count(*) FROM annotation WHERE layer = ? AND category <> ''`, d.Layer).
		Scan(&before); err != nil {
		return 0, fmt.Errorf("draw the sample: %w", err)
	}
	design, _ := json.Marshal(d)
	st, _ := json.Marshal(strata)
	res, err := tx.Exec(`INSERT INTO sample (layer, design, seed, population, strata, created_at, answers_before)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, d.Layer, string(design), seed, population, string(st), t, before)
	if err != nil {
		return 0, fmt.Errorf("draw the sample: %w", err)
	}
	id, _ := res.LastInsertId()
	for _, r := range records {
		if _, err := tx.Exec(`INSERT INTO sample_record (sample_id, fid, stratum, draw_order) VALUES (?, ?, ?, ?)`,
			id, r.FID, r.Stratum, r.Order); err != nil {
			return 0, fmt.Errorf("draw the sample: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("draw the sample: %w", err)
	}
	return id, nil
}

const sampleColumns = `id, design, seed, population, strata, created_at, answers_before, superseded_at`

func scanSample(s interface{ Scan(...any) error }) (*Sample, error) {
	var out Sample
	var design, strata string
	if err := s.Scan(&out.ID, &design, &out.Seed, &out.Population, &strata, &out.CreatedAt,
		&out.AnswersBefore, &out.SupersededAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(design), &out.Design); err != nil {
		return nil, fmt.Errorf("read sample %d: %w", out.ID, err)
	}
	if err := json.Unmarshal([]byte(strata), &out.Strata); err != nil {
		return nil, fmt.Errorf("read sample %d: %w", out.ID, err)
	}
	return &out, nil
}

func (p *Project) sampleByID(id int64) (*Sample, error) {
	s, err := scanSample(p.db.QueryRow(`SELECT `+sampleColumns+` FROM sample WHERE id = ?`, id))
	if err != nil {
		return nil, fmt.Errorf("read sample %d: %w", id, err)
	}
	return s, nil
}

// CurrentSample is the layer's current sample, or nil when it has none.
func (p *Project) CurrentSample(layer string) (*Sample, error) {
	s, err := scanSample(p.db.QueryRow(`SELECT `+sampleColumns+` FROM sample
		WHERE layer = ? AND superseded_at IS NULL`, layer))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read the sample of %s: %w", layer, err)
	}
	return s, nil
}

// Samples lists every sample drawn in the project, replaced ones included,
// in the order drawn.
func (p *Project) Samples() ([]Sample, error) {
	rows, err := p.db.Query(`SELECT ` + sampleColumns + ` FROM sample ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("read the samples: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []Sample
	for rows.Next() {
		s, err := scanSample(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// SampleRecords lists the records of a sample in their order.
func (p *Project) SampleRecords(id int64) ([]SampleRecord, error) {
	rows, err := p.db.Query(`SELECT fid, stratum, draw_order FROM sample_record WHERE sample_id = ? ORDER BY draw_order`, id)
	if err != nil {
		return nil, fmt.Errorf("read the records of sample %d: %w", id, err)
	}
	defer func() { _ = rows.Close() }()
	var out []SampleRecord
	for rows.Next() {
		var r SampleRecord
		if err := rows.Scan(&r.FID, &r.Stratum, &r.Order); err != nil {
			return nil, fmt.Errorf("read the records of sample %d: %w", id, err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SampledLayers lists the layers with a current sample.
func (p *Project) SampledLayers() ([]string, error) {
	rows, err := p.db.Query(`SELECT layer FROM sample WHERE superseded_at IS NULL ORDER BY layer`)
	if err != nil {
		return nil, fmt.Errorf("list sampled layers: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := []string{}
	for rows.Next() {
		var l string
		if err := rows.Scan(&l); err != nil {
			return nil, fmt.Errorf("list sampled layers: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
