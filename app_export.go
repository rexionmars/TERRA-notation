package main

import (
	"path/filepath"

	"terra-point-check/internal/exports"
)

// Export writes the project's annotations into a new folder under
// <project>/exports and shows it in the Finder.
func (a *App) Export() (*exports.Result, error) {
	p, src, err := a.open()
	if err != nil {
		return nil, err
	}
	res, err := exports.Write(p, src, filepath.Join(p.Dir(), "exports"))
	if err != nil {
		return nil, err
	}
	_ = reveal(a.ctx, filepath.Join(res.Dir, "report.html"))
	return res, nil
}
