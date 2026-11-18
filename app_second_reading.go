package main

import (
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"terra-point-check/internal/annotation"
	"terra-point-check/internal/exports"
)

// SecondReadingSource says what a second reading of a layer would be drawn
// from.
type SecondReadingSource struct {
	// Records have a category, within the sample when the layer has one.
	Records    int  `json:"records"`
	FromSample bool `json:"from_sample"`
}

// SecondReadingSource counts the records a second reading of a layer is
// drawn from.
func (a *App) SecondReadingSource(layer string) (*SecondReadingSource, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	cands, sample, err := p.SecondReadingCandidates(layer)
	if err != nil {
		return nil, err
	}
	return &SecondReadingSource{Records: len(cands), FromSample: sample != nil}, nil
}

// SecondReadingMade is the project a second reading was made in.
type SecondReadingMade struct {
	Dir     string `json:"dir"`
	Name    string `json:"name"`
	Records int    `json:"records"`
}

// CreateSecondReading makes a second reading project in a new folder and
// adds it to the recent list. The open project stays open.
func (a *App) CreateSecondReading(r annotation.SecondReading) (*SecondReadingMade, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	q, err := p.CreateSecondReading(r)
	if err != nil {
		return nil, err
	}
	defer func() { _ = q.Close() }()
	info, err := q.Info()
	if err != nil {
		return nil, err
	}
	s, err := q.CurrentSample(r.Layer)
	if err != nil {
		return nil, err
	}
	rememberProject(q.Dir(), info.Name)
	return &SecondReadingMade{Dir: q.Dir(), Name: info.Name, Records: s.Strata[0].Drawn}, nil
}

// CompareSecondReading asks for the folder of a second reading of the open
// project, writes the agreement into a new export folder and shows it. It
// returns nil when the choice is cancelled. The second reading is only read.
func (a *App) CompareSecondReading() (*exports.AgreementResult, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose the folder of the second reading",
	})
	if err != nil || dir == "" {
		return nil, err
	}
	q, err := annotation.OpenReadOnly(dir)
	if err != nil {
		return nil, err
	}
	defer func() { _ = q.Close() }()
	res, err := exports.WriteAgreement(p, q)
	if err != nil {
		return nil, err
	}
	_ = reveal(a.ctx, filepath.Join(res.Dir, "agreement.html"))
	return res, nil
}
