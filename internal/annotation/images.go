package annotation

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // decodes the size of a GIF screenshot
	_ "image/jpeg" // decodes the size of a JPEG screenshot
	_ "image/png"  // decodes the size of a PNG screenshot
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Side is which half of the comparison a screenshot belongs to.
type Side string

// The two sides: what the GeoPackage shows, and what the reference map
// (Google Maps, Street View) shows.
const (
	SideSource    Side = "source"
	SideReference Side = "reference"
)

// ParseSide checks a side sent by the interface.
func ParseSide(s string) (Side, error) {
	switch Side(s) {
	case SideSource, SideReference:
		return Side(s), nil
	}
	return "", fmt.Errorf("side %q is neither source nor reference", s)
}

// Image is one screenshot.
type Image struct {
	ID    int64  `json:"id"`
	Layer string `json:"layer"`
	FID   int64  `json:"fid"`
	Side  Side   `json:"side"`
	// Path is relative to the project folder, with forward slashes.
	Path       string `json:"path"`
	SHA256     string `json:"sha256"`
	Bytes      int64  `json:"bytes"`
	Width      *int   `json:"width"`
	Height     *int   `json:"height"`
	Origin     string `json:"origin"`
	Detail     string `json:"detail"`
	CapturedAt string `json:"captured_at"`
	// ImageryDate and ImagerySource describe the basemap imagery a map
	// capture shows at the record, as its provider gives them; both are
	// empty for every other screenshot and when the provider gave nothing.
	ImageryDate   string `json:"imagery_date"`
	ImagerySource string `json:"imagery_source"`
}

// Imagery is what the basemap's provider says about the imagery at a record.
type Imagery struct {
	// Date is YYYY-MM-DD, or "" when the provider gives none.
	Date string `json:"date"`
	// Source names the sensor, resolution and provider in one line.
	Source string `json:"source"`
}

// The origins of a screenshot.
const (
	OriginAppMap       = "app_map"
	OriginScreenRegion = "screen_region"
	OriginClipboard    = "clipboard"
	OriginFile         = "file"
)

// MaxImageBytes bounds one screenshot. A full Retina screen as PNG is under
// 20 MB; a file far past this was picked by mistake.
const MaxImageBytes = 64 << 20

func imageExtension(data []byte) (string, error) {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return ".png", nil
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return ".jpg", nil
	case bytes.HasPrefix(data, []byte("GIF87a")), bytes.HasPrefix(data, []byte("GIF89a")):
		return ".gif", nil
	case len(data) > 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return ".webp", nil
	}
	return "", errors.New("the file is not a PNG, JPEG, GIF or WebP image")
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

const imageColumns = `id, layer, fid, side, path, sha256, bytes, width, height, origin, detail, captured_at,
	imagery_date, imagery_source`

func scanImage(s interface{ Scan(...any) error }) (*Image, error) {
	var img Image
	var w, h sql.NullInt64
	if err := s.Scan(&img.ID, &img.Layer, &img.FID, &img.Side, &img.Path, &img.SHA256, &img.Bytes,
		&w, &h, &img.Origin, &img.Detail, &img.CapturedAt, &img.ImageryDate, &img.ImagerySource); err != nil {
		return nil, err
	}
	if w.Valid && h.Valid {
		wi, hi := int(w.Int64), int(h.Int64)
		img.Width, img.Height = &wi, &hi
	}
	return &img, nil
}

func (p *Project) currentImage(q querier, layer string, fid int64, side Side) (*Image, error) {
	img, err := scanImage(q.QueryRow(`SELECT `+imageColumns+` FROM image
		WHERE layer = ? AND fid = ? AND side = ? AND removed_at IS NULL ORDER BY id DESC LIMIT 1`, layer, fid, side))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read screenshot of %s/%d: %w", layer, fid, err)
	}
	return img, nil
}

// Image returns one screenshot by id.
func (p *Project) Image(id int64) (*Image, error) {
	img, err := scanImage(p.db.QueryRow(`SELECT `+imageColumns+` FROM image WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("the project has no screenshot %d", id)
	}
	if err != nil {
		return nil, fmt.Errorf("read screenshot %d: %w", id, err)
	}
	return img, nil
}

// AddImage stores a screenshot as the current one of its side. The one it
// replaces keeps its file and row.
func (p *Project) AddImage(layer string, fid int64, side Side, data []byte, origin, detail string) (*Image, error) {
	return p.addImage(layer, fid, side, data, origin, detail, Imagery{})
}

// AddMapCapture stores the picture of the application's map as the current
// layer-side screenshot, with what is known of the imagery at the record.
func (p *Project) AddMapCapture(layer string, fid int64, data []byte, detail string, imagery Imagery) (*Image, error) {
	if imagery.Date != "" {
		if _, err := time.Parse("2006-01-02", imagery.Date); err != nil {
			return nil, fmt.Errorf("the imagery date %q is not YYYY-MM-DD", imagery.Date)
		}
	}
	return p.addImage(layer, fid, SideSource, data, OriginAppMap, detail, imagery)
}

func (p *Project) addImage(layer string, fid int64, side Side, data []byte, origin, detail string, imagery Imagery) (*Image, error) {
	if len(data) == 0 {
		return nil, errors.New("the screenshot is empty")
	}
	if len(data) > MaxImageBytes {
		return nil, fmt.Errorf("the screenshot has %d MB; the limit is %d MB", len(data)>>20, MaxImageBytes>>20)
	}
	ext, err := imageExtension(data)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	t := time.Now().UTC()
	folder := path.Join(ImagesDir, unsafeName.ReplaceAllString(layer, "_"), fmt.Sprint(fid))
	if err := os.MkdirAll(filepath.Join(p.dir, filepath.FromSlash(folder)), 0o755); err != nil {
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	/*
		O_EXCL: a name is never reused, so a file once referenced by the
		history is never overwritten. Two screenshots of one side within the
		same millisecond (a paste pressed twice) take the next free number
		after the time instead of failing.
	*/
	stem := fmt.Sprintf("%s-%s", side, t.Format("20060102T150405.000Z"))
	var (
		rel, abs string
		f        *os.File
	)
	for n := 1; n <= 100; n++ {
		name := stem + ext
		if n > 1 {
			name = fmt.Sprintf("%s-%d%s", stem, n, ext)
		}
		rel = path.Join(folder, name)
		abs = filepath.Join(p.dir, filepath.FromSlash(rel))
		f, err = os.OpenFile(abs, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if !errors.Is(err, fs.ErrExist) {
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(abs)
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(abs)
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	var width, height any
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		width, height = cfg.Width, cfg.Height
	}
	tx, err := p.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	stamp := t.Format(time.RFC3339)
	if _, err := tx.Exec(`UPDATE image SET removed_at = ? WHERE layer = ? AND fid = ? AND side = ? AND removed_at IS NULL`,
		stamp, layer, fid, side); err != nil {
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	res, err := tx.Exec(`INSERT INTO image (layer, fid, side, path, sha256, bytes, width, height, origin, detail,
		captured_at, imagery_date, imagery_source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		layer, fid, side, rel, hex.EncodeToString(sum[:]), len(data), width, height, origin, strings.TrimSpace(detail),
		stamp, imagery.Date, strings.TrimSpace(imagery.Source))
	if err != nil {
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("save screenshot: %w", err)
	}
	id, _ := res.LastInsertId()
	return p.Image(id)
}

// RemoveImage stops a screenshot from being current. Its file stays in the
// project folder and its row in the table.
func (p *Project) RemoveImage(id int64) error {
	res, err := p.db.Exec(`UPDATE image SET removed_at = ? WHERE id = ? AND removed_at IS NULL`, now(), id)
	if err != nil {
		return fmt.Errorf("remove screenshot %d: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("screenshot %d is not current", id)
	}
	return nil
}

// ImageFile resolves a path the interface asks for to a file inside the
// project's images folder, refusing anything outside it.
func (p *Project) ImageFile(rel string) (string, error) {
	clean := path.Clean("/" + rel)[1:]
	if !strings.HasPrefix(clean, ImagesDir+"/") {
		return "", errors.New("not a screenshot path")
	}
	return filepath.Join(p.dir, filepath.FromSlash(clean)), nil
}
