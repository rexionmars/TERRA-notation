package exports

import (
	"errors"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	"terra-point-check/internal/annotation"
)

/*
The agreement between a project and a second reading of it. Each record is
compared by its first answer on both sides: the first answers are the ones
given without knowing the other reading, and a later revision may follow a
talk about the disagreements. The current answers are in the CSV beside them.

Observed agreement has a Wilson interval. Kappa is not given: it folds the
categories' prevalence into one number, and the confusion table, which
carries everything a coefficient is computed from, is written instead.
*/

// AgreementLayer sums up one layer of a comparison.
type AgreementLayer struct {
	Layer string `json:"layer"`
	// Records counts the records of the second reading.
	Records int `json:"records"`
	// Pairs counts those both readings gave a category.
	Pairs    int     `json:"pairs"`
	Agreeing int     `json:"agreeing"`
	Share    float64 `json:"share"`
	Low      float64 `json:"low"`
	High     float64 `json:"high"`
}

// AgreementResult lists what a comparison wrote.
type AgreementResult struct {
	Dir    string           `json:"dir"`
	Files  []string         `json:"files"`
	Second string           `json:"second"`
	Layers []AgreementLayer `json:"layers"`
}

type agreementRow struct {
	fid                    int64
	id, name               string
	firstA, firstB         string
	currentA, currentB     string
	annotatorA, annotatorB string
}

type agreementCategory struct {
	Label            string
	First, Second    int
	Agreeing         int
	SpecificAgreeing string
}

type agreementPage struct {
	First, Second   string
	FirstAnnotator  string
	SecondAnnotator string
	Exported        string
	Layers          []agreementPageLayer
}

type agreementPageLayer struct {
	Name          string
	Summary       string
	Unpaired      string
	Categories    []agreementCategory
	Labels        []string
	Matrix        [][]int
	Disagreements []agreementRow
}

func (r agreementRow) FID() int64   { return r.fid }
func (r agreementRow) Name() string { return r.name }
func (r agreementRow) A() string    { return r.firstA }
func (r agreementRow) B() string    { return r.firstB }

var agreementTemplate = template.Must(template.New("agreement").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agreement: {{.First}} and {{.Second}}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; margin: 24px auto; max-width: 1100px; padding: 0 16px; color: #1a1a1a; background: #fff; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 36px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .meta { color: #555; font-size: 13px; }
  table { border-collapse: collapse; font-size: 13px; margin: 12px 0 20px; }
  th { text-align: left; font-weight: normal; color: #555; border-bottom: 1px solid #ccc; padding: 4px 14px 4px 0; }
  td { border-bottom: 1px solid #e5e5e5; padding: 4px 14px 4px 0; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  td.same { font-weight: bold; }
</style>
</head>
<body>
<h1>Agreement: {{.First}} and {{.Second}}</h1>
<div class="meta">First reading by {{.FirstAnnotator}}; second reading by {{.SecondAnnotator}} &middot; compared {{.Exported}}.
Each record is compared by its first answer on each side, the one given without the other in view.</div>
{{range .Layers}}
<h2>Layer {{.Name}}</h2>
<p>{{.Summary}}</p>
{{if .Unpaired}}<p class="meta">{{.Unpaired}}</p>{{end}}
<table>
<tr><th>Category</th><th class="n">First reading</th><th class="n">Second reading</th><th class="n">Both</th><th class="n">Specific agreement</th></tr>
{{range .Categories}}<tr><td>{{.Label}}</td><td class="n">{{.First}}</td><td class="n">{{.Second}}</td><td class="n">{{.Agreeing}}</td><td class="n">{{.SpecificAgreeing}}</td></tr>{{end}}
</table>
<p class="meta">Specific agreement is 2 &times; both / (first + second): of the times either reading chose the category, the share in which both did.</p>
<table>
<tr><th>First reading &darr; / second &rarr;</th>{{range .Labels}}<th class="n">{{.}}</th>{{end}}</tr>
{{$labels := .Labels}}{{range $i, $row := .Matrix}}<tr><td>{{index $labels $i}}</td>{{range $j, $n := $row}}<td class="n{{if eq $i $j}} same{{end}}">{{$n}}</td>{{end}}</tr>{{end}}
</table>
{{if .Disagreements}}
<table>
<tr><th class="n">fid</th><th>Record</th><th>First reading</th><th>Second reading</th></tr>
{{range .Disagreements}}<tr><td class="n">{{.FID}}</td><td>{{.Name}}</td><td>{{.A}}</td><td>{{.B}}</td></tr>{{end}}
</table>
{{end}}
{{end}}
</body>
</html>
`))

// WriteAgreement compares first with second, a second reading made from it,
// and writes the comparison into a new folder of first's exports.
func WriteAgreement(first, second *annotation.Project) (*AgreementResult, error) {
	ok, err := first.IsSecondReadingOf(second)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("the project in %s is not a second reading of this one", second.Dir())
	}
	srcA, err := first.Source()
	if err != nil {
		return nil, err
	}
	srcB, err := second.Source()
	if err != nil {
		return nil, err
	}
	if srcA.SHA256 != srcB.SHA256 {
		return nil, errors.New("the second reading is tied to a GeoPackage with another SHA-256, so its feature ids may name other records")
	}
	infoA, err := first.Info()
	if err != nil {
		return nil, err
	}
	infoB, err := second.Info()
	if err != nil {
		return nil, err
	}
	samples, err := second.Samples()
	if err != nil {
		return nil, err
	}
	// The latest second-reading sample of each layer.
	byLayer := map[string]annotation.Sample{}
	for _, s := range samples {
		if s.Design.Kind == annotation.KindSecondReading {
			byLayer[s.Design.Layer] = s
		}
	}
	if len(byLayer) == 0 {
		return nil, errors.New("the second reading has no records drawn for it")
	}
	layers := make([]string, 0, len(byLayer))
	for l := range byLayer {
		layers = append(layers, l)
	}
	sort.Strings(layers)
	labels := map[string]string{}
	order := map[string]int{}
	for i, c := range infoA.Settings.Categories {
		labels[c.ID] = c.Label
		order[c.ID] = i
	}
	dir, err := newExportDir(filepath.Join(first.Dir(), "exports"), "_agreement")
	if err != nil {
		return nil, err
	}
	res := &AgreementResult{Dir: dir, Second: infoB.Name}
	page := agreementPage{First: infoA.Name, Second: infoB.Name, FirstAnnotator: infoA.Settings.Annotator,
		SecondAnnotator: infoB.Settings.Annotator, Exported: time.Now().Format("2006-01-02 15:04")}
	for _, layer := range layers {
		recs, err := second.SampleRecords(byLayer[layer].ID)
		if err != nil {
			return nil, err
		}
		annA, err := annotationsByFID(first, layer)
		if err != nil {
			return nil, err
		}
		annB, err := annotationsByFID(second, layer)
		if err != nil {
			return nil, err
		}
		var rows []agreementRow
		for _, r := range recs {
			row := agreementRow{fid: r.FID}
			if a := annA[r.FID]; a != nil {
				row.id, row.name, row.firstA, row.currentA, row.annotatorA = a.RecordID, a.RecordName, a.FirstCategory, a.Category, a.Annotator
			}
			if b := annB[r.FID]; b != nil {
				row.firstB, row.currentB, row.annotatorB = b.FirstCategory, b.Category, b.Annotator
				if row.name == "" {
					row.id, row.name = b.RecordID, b.RecordName
				}
			}
			rows = append(rows, row)
		}
		files, sum, pl, err := writeLayerAgreement(dir, layer, rows, infoA.Settings.Categories, labels, order)
		if err != nil {
			return nil, err
		}
		res.Files = append(res.Files, files...)
		res.Layers = append(res.Layers, sum)
		page.Layers = append(page.Layers, pl)
	}
	f := filepath.Join(dir, "agreement.html")
	out, err := os.Create(f)
	if err != nil {
		return nil, fmt.Errorf("write agreement.html: %w", err)
	}
	if err := agreementTemplate.Execute(out, page); err != nil {
		_ = out.Close()
		return nil, fmt.Errorf("write agreement.html: %w", err)
	}
	if err := out.Close(); err != nil {
		return nil, fmt.Errorf("write agreement.html: %w", err)
	}
	res.Files = append(res.Files, f)
	return res, nil
}

func annotationsByFID(p *annotation.Project, layer string) (map[int64]*annotation.Annotation, error) {
	anns, err := p.Annotations(layer)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]*annotation.Annotation, len(anns))
	for i := range anns {
		out[anns[i].FID] = &anns[i]
	}
	return out, nil
}

func writeLayerAgreement(dir, layer string, rows []agreementRow, cats []annotation.Category,
	labels map[string]string, order map[string]int) ([]string, AgreementLayer, agreementPageLayer, error) {
	sum := AgreementLayer{Layer: layer, Records: len(rows)}
	pl := agreementPageLayer{Name: layer}
	n := len(cats)
	matrix := make([][]int, n)
	for i := range matrix {
		matrix[i] = make([]int, n)
	}
	var csvRows [][]string
	for _, r := range rows {
		agree := ""
		if r.firstA != "" && r.firstB != "" {
			i, okA := order[r.firstA]
			j, okB := order[r.firstB]
			if okA && okB {
				matrix[i][j]++
				sum.Pairs++
				if r.firstA == r.firstB {
					sum.Agreeing++
					agree = "1"
				} else {
					agree = "0"
					rr := r
					rr.firstA, rr.firstB = labels[r.firstA], labels[r.firstB]
					pl.Disagreements = append(pl.Disagreements, rr)
				}
			}
		}
		csvRows = append(csvRows, []string{layer, strconv.FormatInt(r.fid, 10), r.id, r.name, r.firstA, r.firstB, agree,
			r.currentA, r.currentB, r.annotatorA, r.annotatorB})
	}
	f := filepath.Join(dir, "agreement_"+layer+".csv")
	if err := writeCSV(f, []string{"layer", "fid", "record_id", "record_name", "first_reading_first_category",
		"second_reading_first_category", "agree", "first_reading_category", "second_reading_category",
		"first_reading_annotator", "second_reading_annotator"}, csvRows); err != nil {
		return nil, sum, pl, err
	}
	header := []string{"first_reading \\ second_reading"}
	for _, c := range cats {
		header = append(header, c.ID)
		pl.Labels = append(pl.Labels, c.Label)
	}
	var mRows [][]string
	for i, c := range cats {
		row := []string{c.ID}
		for j := range cats {
			row = append(row, strconv.Itoa(matrix[i][j]))
		}
		mRows = append(mRows, row)
	}
	g := filepath.Join(dir, "agreement_matrix_"+layer+".csv")
	if err := writeCSV(g, header, mRows); err != nil {
		return nil, sum, pl, err
	}
	pl.Matrix = matrix
	if sum.Pairs > 0 {
		sum.Share = float64(sum.Agreeing) / float64(sum.Pairs)
		sum.Low, sum.High = wilson(sum.Agreeing, sum.Pairs)
		pl.Summary = fmt.Sprintf("Both readings gave the same first answer for %s of the %s records both answered: "+
			"%s (95 %% Wilson interval %s to %s).", count(sum.Agreeing), count(sum.Pairs), percent(sum.Share),
			percent(sum.Low), percent(sum.High))
	} else {
		pl.Summary = "No record has a first answer in both readings yet."
	}
	if unpaired := sum.Records - sum.Pairs; unpaired > 0 {
		pl.Unpaired = fmt.Sprintf("%s of the second reading %s left out: one of the readings has no category for them.",
			counted(unpaired, "record", "records"), map[bool]string{true: "is", false: "are"}[unpaired == 1])
	}
	for i, c := range cats {
		row, col := 0, 0
		for j := range cats {
			row += matrix[i][j]
			col += matrix[j][i]
		}
		ac := agreementCategory{Label: c.Label, First: row, Second: col, Agreeing: matrix[i][i], SpecificAgreeing: "none chose it"}
		if row+col > 0 {
			ac.SpecificAgreeing = percent(2 * float64(matrix[i][i]) / float64(row+col))
		}
		pl.Categories = append(pl.Categories, ac)
	}
	return []string{f, g}, sum, pl, nil
}
