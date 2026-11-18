package exports

import (
	"fmt"
	"html/template"
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

type reportLayer struct {
	Name      string
	SourceErr string
	Counts    []reportCount
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
