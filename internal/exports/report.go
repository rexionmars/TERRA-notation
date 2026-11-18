package exports

import (
	"fmt"
	"html/template"
	"math"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"terra-point-check/internal/annotation"
)

// The report is read by people, so a negative number carries the
// typographic minus (U+2212) rather than a hyphen.
func formatNumber(f float64, decimals int) string {
	return strings.Replace(strconv.FormatFloat(f, 'f', decimals, 64), "-", "\u2212", 1)
}

// formatTime gives a stored UTC time in the reader's local time, in the ISO
// order, which no reader takes for day-month or month-day.
func formatTime(rfc3339 string) string {
	t, err := time.Parse(time.RFC3339, rfc3339)
	if err != nil {
		return rfc3339
	}
	return t.Local().Format("2006-01-02 15:04")
}

var origins = map[string]string{
	annotation.OriginAppMap:       "map in the application",
	annotation.OriginScreenRegion: "screen region",
	annotation.OriginClipboard:    "clipboard",
	annotation.OriginFile:         "file",
}

type reportImage struct {
	Src     string
	Caption string
}

type reportCard struct {
	Title         string
	Subtitle      string
	Category      string
	FirstCategory string
	Reference     string
	ImageryDate   string
	Notes         string
	Position      string
	Revisions     int
	Saved         string
	Source        *reportImage
	Ref           *reportImage
}

type reportCount struct {
	Label string
	N     int
}

type reportShareRow struct {
	Label    string
	Count    int
	N        int
	Share    string
	Interval string
}

type reportShareTable struct {
	Title string
	Rows  []reportShareRow
}

// reportEstimates is the share of each category, what it is over, and what
// it leaves out.
type reportEstimates struct {
	Intro  string
	Status string
	Method string
	Notes  []string
	Pace   string
	Tables []reportShareTable
}

type reportLayer struct {
	Name      string
	SourceErr string
	Counts    []reportCount
	Estimates reportEstimates
	Cards     []reportCard
}

type reportPage struct {
	Project    string
	SourceFile string
	SourceSHA  string
	Exported   string
	Layers     []reportLayer
}

var reportTemplate = template.Must(template.New("report").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Annotations: {{.Project}}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; margin: 24px auto; max-width: 1200px; padding: 0 16px; color: #1a1a1a; background: #fff; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 40px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 15px; margin: 0 0 2px; }
  .meta { color: #555; font-size: 13px; }
  table.counts { border-collapse: collapse; font-size: 13px; margin: 12px 0 24px; }
  table.counts td { border-bottom: 1px solid #e5e5e5; padding: 4px 16px 4px 0; }
  table.counts td.n { text-align: right; font-variant-numeric: tabular-nums; }
  table.shares { border-collapse: collapse; font-size: 13px; margin: 12px 0 8px; }
  table.shares caption { text-align: left; font-weight: bold; padding-bottom: 4px; }
  table.shares th { text-align: left; font-weight: normal; color: #555; border-bottom: 1px solid #ccc; padding: 4px 16px 4px 0; }
  table.shares td { border-bottom: 1px solid #e5e5e5; padding: 4px 16px 4px 0; }
  table.shares .n { text-align: right; font-variant-numeric: tabular-nums; }
  h3.cards { margin-top: 24px; }
  .card { border: 1px solid #d4d4d4; border-radius: 6px; padding: 14px; margin: 16px 0; break-inside: avoid; }
  .sub { color: #555; font-size: 12px; margin-bottom: 8px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 13px; margin: 8px 0 12px; }
  dt { color: #555; }
  dd { margin: 0; white-space: pre-wrap; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  figure { margin: 0; }
  figure img { width: 100%; border: 1px solid #ccc; }
  figcaption { font-size: 12px; color: #555; margin-top: 4px; }
  .missing { border: 1px dashed #bbb; color: #777; font-size: 13px; padding: 32px 8px; text-align: center; }
  @media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>Annotations: {{.Project}}</h1>
<div class="meta">GeoPackage: {{.SourceFile}} (SHA-256 {{.SourceSHA}}) &middot; exported {{.Exported}}</div>
{{range .Layers}}
<h2>Layer {{.Name}}</h2>
{{if .SourceErr}}<p class="meta">The layer's attributes could not be read: {{.SourceErr}}</p>{{end}}
{{with .Estimates}}
<p>{{.Intro}}</p>
{{if .Status}}<p class="meta">{{.Status}}</p>{{end}}
{{range .Tables}}
<table class="shares">
<caption>{{.Title}}</caption>
<tr><th>Category</th><th class="n">Records</th><th class="n">Share</th><th class="n">95 % interval</th></tr>
{{range .Rows}}<tr><td>{{.Label}}</td><td class="n">{{.Count}} of {{.N}}</td><td class="n">{{.Share}}</td><td class="n">{{.Interval}}</td></tr>{{end}}
</table>
{{end}}
<p class="meta">{{.Method}}</p>
{{range .Notes}}<p class="meta">{{.}}</p>{{end}}
{{if .Pace}}<p class="meta">{{.Pace}}</p>{{end}}
{{end}}
<h3 class="cards">Records with an answer or a screenshot, by category</h3>
<table class="counts">
{{range .Counts}}<tr><td>{{.Label}}</td><td class="n">{{.N}}</td></tr>{{end}}
</table>
{{range .Cards}}
<div class="card">
  <h3>{{.Title}}</h3>
  <div class="sub">{{.Subtitle}}</div>
  <dl>
    <dt>Category</dt><dd>{{if .Category}}{{.Category}}{{else}}no category{{end}}</dd>
    {{if .FirstCategory}}<dt>First category</dt><dd>{{.FirstCategory}}</dd>{{end}}
    {{if .Reference}}<dt>On the reference map</dt><dd>{{.Reference}}</dd>{{end}}
    {{if .ImageryDate}}<dt>Date of the reference imagery</dt><dd>{{.ImageryDate}}</dd>{{end}}
    {{if .Notes}}<dt>Notes</dt><dd>{{.Notes}}</dd>{{end}}
    {{if .Position}}<dt>Position in the layer</dt><dd>{{.Position}}</dd>{{end}}
    {{if .Saved}}<dt>Saved</dt><dd>{{.Saved}} ({{.Revisions}} {{if eq .Revisions 1}}revision{{else}}revisions{{end}})</dd>{{end}}
  </dl>
  <div class="pair">
    {{with .Source}}<figure><img src="{{.Src}}" alt="screenshot of the layer"><figcaption>{{.Caption}}</figcaption></figure>{{else}}<div class="missing">no screenshot of the layer</div>{{end}}
    {{with .Ref}}<figure><img src="{{.Src}}" alt="screenshot of the reference map"><figcaption>{{.Caption}}</figcaption></figure>{{else}}<div class="missing">no screenshot of the reference map</div>{{end}}
  </div>
</div>
{{end}}
{{end}}
</body>
</html>
`))

func writeReport(file, exportDir, projectDir string, all []layerData, labels map[string]string, info annotation.Info) error {
	rel, err := filepath.Rel(exportDir, projectDir)
	if err != nil {
		return fmt.Errorf("write report: %w", err)
	}
	imgOf := func(img *annotation.Image, side string) *reportImage {
		if img == nil {
			return nil
		}
		caption := fmt.Sprintf("%s: %s, %s", side, origins[img.Origin], formatTime(img.CapturedAt))
		if img.Detail != "" {
			caption += " \u00b7 " + img.Detail
		}
		if img.ImageryDate != "" {
			caption += " \u00b7 imagery of " + img.ImageryDate
			if img.ImagerySource != "" {
				caption += " (" + img.ImagerySource + ")"
			}
		}
		return &reportImage{Src: path.Join(filepath.ToSlash(rel), img.Path), Caption: caption}
	}
	order := map[string]int{}
	for i, c := range info.Settings.Categories {
		order[c.ID] = i
	}
	page := reportPage{
		Project:    info.Name,
		SourceFile: filepath.Base(info.Source.Path),
		SourceSHA:  info.Source.SHA256,
		Exported:   time.Now().Format("2006-01-02 15:04"),
	}
	for _, ld := range all {
		rl := reportLayer{Name: ld.name, SourceErr: ld.sourceErr}
		counts := map[string]int{}
		recs := append([]record{}, ld.records...)
		catOf := func(r record) string {
			if r.ann == nil {
				return ""
			}
			return r.ann.Category
		}
		rank := func(r record) int {
			if o, ok := order[catOf(r)]; ok {
				return o
			}
			return len(order)
		}
		sort.SliceStable(recs, func(i, j int) bool { return rank(recs[i]) < rank(recs[j]) })
		for _, r := range recs {
			c := catOf(r)
			counts[c]++
			card := reportCard{
				Title:    r.name(),
				Subtitle: "fid " + strconv.FormatInt(r.fid, 10),
				Source:   imgOf(r.src, "Layer"),
				Ref:      imgOf(r.ref, "Reference"),
			}
			if card.Title == "" {
				card.Title = "(no name)"
			}
			if lon, lat := r.position(); lon != nil && lat != nil {
				card.Position = "lat " + formatNumber(*lat, 6) + ", lon " + formatNumber(*lon, 6) + " (WGS 84)"
			}
			if a := r.ann; a != nil {
				if a.RecordID != "" {
					card.Subtitle += " \u00b7 id " + a.RecordID
				}
				card.Category = labels[a.Category]
				if a.FirstCategory != "" && a.FirstCategory != a.Category {
					card.FirstCategory = labels[a.FirstCategory]
				}
				card.Reference, card.Notes, card.Revisions = a.ReferenceLabel, a.Notes, r.revisions
				if date, status := referenceDateCells(a.ReferenceDate); date != "" {
					card.ImageryDate = date
				} else {
					card.ImageryDate = status
				}
				card.Saved = formatTime(a.UpdatedAt)
				if a.Annotator != "" {
					card.Saved += " by " + a.Annotator
				}
			}
			rl.Cards = append(rl.Cards, card)
		}
		rl.Estimates = estimatesSection(ld, labels)
		for _, c := range info.Settings.Categories {
			if n := counts[c.ID]; n > 0 {
				rl.Counts = append(rl.Counts, reportCount{Label: c.Label, N: n})
			}
		}
		if n := counts[""]; n > 0 {
			rl.Counts = append(rl.Counts, reportCount{Label: "no category", N: n})
		}
		page.Layers = append(page.Layers, rl)
	}
	f, err := os.Create(file)
	if err != nil {
		return fmt.Errorf("write report: %w", err)
	}
	if err := reportTemplate.Execute(f, page); err != nil {
		_ = f.Close()
		return fmt.Errorf("write report: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("write report: %w", err)
	}
	return nil
}

// count writes a whole number for a reader, its thousands grouped with a
// narrow no-break space, as the page groups them.
func count(n int) string {
	d := strconv.Itoa(n)
	for i := len(d) - 3; i > 0; i -= 3 {
		d = d[:i] + "\u202f" + d[i:]
	}
	return d
}

// counted is "1 record" or "2 records".
func counted(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return count(n) + " " + many
}

// percent writes a share for a reader: 23.5 %, with the space SI puts before
// the sign.
func percent(f float64) string {
	return formatNumber(f*100, 1) + "\u202f%"
}

func estimatesSection(ld layerData, labels map[string]string) reportEstimates {
	var e reportEstimates
	tables := map[string]*reportShareTable{}
	var order []string
	notes := map[string]bool{}
	for _, sh := range ld.shares {
		key := "(all)"
		title := "The whole population"
		if !sh.All {
			key = "stratum " + sh.Stratum
			name := sh.Stratum
			if name == "" {
				name = "(empty)"
			}
			title = fmt.Sprintf("Stratum %s = %s", ld.sample.Design.StratumColumn, name)
		}
		t, ok := tables[key]
		if !ok {
			t = &reportShareTable{Title: title}
			tables[key] = t
			order = append(order, key)
		}
		row := reportShareRow{Label: labels[sh.Category], Count: sh.Count, N: sh.N, Share: "no answers", Interval: "none"}
		if sh.N > 0 && !math.IsNaN(sh.Share) {
			row.Share = percent(sh.Share)
		}
		switch {
		case sh.HasCI:
			row.Interval = percent(sh.Low) + " to " + percent(sh.High)
		case sh.Note != "":
			row.Interval = "not computed"
			notes[sh.Note] = true
		}
		t.Rows = append(t.Rows, row)
		if sh.All {
			e.Method = "Whole population: " + sh.Method + "."
		} else if !strings.Contains(e.Method, "Each stratum") {
			e.Method += " Each stratum: " + sh.Method + "."
		}
	}
	for _, k := range order {
		e.Tables = append(e.Tables, *tables[k])
	}
	for n := range notes {
		e.Notes = append(e.Notes, "The estimate for the whole population was "+n+".")
	}
	sort.Strings(e.Notes)
	if ld.sample == nil {
		e.Intro = "Shares of the records answered so far. They describe those records only: " +
			"no sample was drawn before the annotation, so they are not estimates for the layer."
		e.Method = "No interval: the records were not drawn as a sample before annotation."
	} else {
		s := ld.sample
		pop := fmt.Sprintf("all %s records of the layer", count(s.Population))
		if s.Design.Condition != "" {
			pop = fmt.Sprintf("the %s records where %s", count(s.Population), s.Design.Condition)
		}
		e.Intro = fmt.Sprintf("Estimated share of each category in %s, from sample %d (seed %d, drawn %s), "+
			"over its records with a category, by their current answer.", pop, s.ID, s.Seed, formatTime(s.CreatedAt))
		category := map[int64]string{}
		for _, r := range ld.records {
			if r.ann != nil {
				category[r.fid] = r.ann.Category
			}
		}
		status := map[string]int{}
		for _, st := range sampleStatus(ld.sampleRecords, category) {
			status[st]++
		}
		e.Status = fmt.Sprintf("Of the %s of the sample, %s a category, %s passed over and %s "+
			"not reached yet. The estimate takes the records without a category to be like the answered "+
			"ones of their stratum; passed-over records are where that can fail.",
			counted(len(ld.sampleRecords), "record", "records"),
			counted(status[statusAnswered], "has", "have"),
			counted(status[statusPassedOver], "was", "were"),
			counted(status[statusNotReached], "is", "are"))
		if s.AnswersBefore > 0 {
			e.Notes = append(e.Notes, fmt.Sprintf("%s of the layer had a category when the sample was drawn.",
				counted(s.AnswersBefore, "record", "records")))
		}
	}
	if ld.pace.Timed > 0 {
		e.Pace = fmt.Sprintf("Median time from opening a record to its first answer: %s\u00a0s, over %s.",
			formatNumber(ld.pace.MedianSeconds, 0), counted(ld.pace.Timed, "record", "records"))
	}
	return e
}
