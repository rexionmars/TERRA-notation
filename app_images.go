package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"terra-point-check/internal/annotation"
)

// imageRoute is the URL prefix under which the page reads screenshots.
const imageRoute = "/project-images/"

// imageMiddleware serves screenshots from the open project's images folder.
func (a *App) imageMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, imageRoute) {
			next.ServeHTTP(w, r)
			return
		}
		p, _, err := a.open()
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		file, err := p.ImageFile(strings.TrimPrefix(r.URL.Path, imageRoute))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		f, err := os.Open(file)
		if err != nil {
			http.Error(w, "screenshot not found", http.StatusNotFound)
			return
		}
		defer func() { _ = f.Close() }()
		st, err := f.Stat()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// A screenshot's name is never reused, so it never changes.
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeContent(w, r, st.Name(), st.ModTime(), f)
	})
}

// SaveMapCapture stores the picture of the application's map, sent by the
// page as a data URL, with what Esri said of the imagery at the record.
func (a *App) SaveMapCapture(layer string, fid int64, dataURL, detail string, imagery annotation.Imagery) (*annotation.Image, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		return nil, errors.New("the map picture is not a PNG data URL")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
	if err != nil {
		return nil, fmt.Errorf("decode the map picture: %w", err)
	}
	return p.AddMapCapture(layer, fid, data, detail, imagery)
}

// ImportImageFile stores an image file, dropped on a slot or chosen in a
// dialog, as the screenshot of one side.
func (a *App) ImportImageFile(layer string, fid int64, side, path string) (*annotation.Image, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	s, err := annotation.ParseSide(side)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	if st.Size() > annotation.MaxImageBytes {
		return nil, fmt.Errorf("%s has %d MB; the limit is %d MB", filepath.Base(path), st.Size()>>20, annotation.MaxImageBytes>>20)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	return p.AddImage(layer, fid, s, data, annotation.OriginFile, filepath.Base(path))
}

// PickImageFile asks for an image file and stores it. It returns nil when
// the dialog is cancelled.
func (a *App) PickImageFile(layer string, fid int64, side string) (*annotation.Image, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose a screenshot",
		Filters: []runtime.FileFilter{{
			DisplayName: "Images (*.png, *.jpg, *.jpeg, *.webp, *.gif)",
			Pattern:     "*.png;*.jpg;*.jpeg;*.webp;*.gif",
		}},
	})
	if err != nil || path == "" {
		return nil, err
	}
	return a.ImportImageFile(layer, fid, side, path)
}

// CaptureScreenRegion hides the window, lets the reader select a region of
// the screen (the browser with Google Maps, or QGIS) and stores it. It
// returns nil when the selection is cancelled.
func (a *App) CaptureScreenRegion(layer string, fid int64, side string) (*annotation.Image, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	s, err := annotation.ParseSide(side)
	if err != nil {
		return nil, err
	}
	tmp, err := os.MkdirTemp("", "terra-point-check-capture-")
	if err != nil {
		return nil, fmt.Errorf("capture the screen: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmp) }()
	file := filepath.Join(tmp, "region.png")

	runtime.WindowHide(a.ctx)
	// The window takes a moment to leave the screen; a selection started
	// before that would include it.
	time.Sleep(250 * time.Millisecond)
	err = captureRegion(a.ctx, file)
	runtime.WindowShow(a.ctx)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read the screen capture: %w", err)
	}
	return p.AddImage(layer, fid, s, data, annotation.OriginScreenRegion, "")
}

// PasteImage stores the image on the clipboard as the screenshot of one
// side.
func (a *App) PasteImage(layer string, fid int64, side string) (*annotation.Image, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	s, err := annotation.ParseSide(side)
	if err != nil {
		return nil, err
	}
	data, err := clipboardImage(a.ctx)
	if err != nil {
		return nil, err
	}
	return p.AddImage(layer, fid, s, data, annotation.OriginClipboard, "")
}

// RemoveImage stops a screenshot from being current; its file stays.
func (a *App) RemoveImage(id int64) error {
	p, _, err := a.open()
	if err != nil {
		return err
	}
	return p.RemoveImage(id)
}
