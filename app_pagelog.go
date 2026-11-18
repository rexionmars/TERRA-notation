package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// pageLogLimit bounds the page log; past it the file starts over, keeping the
// previous one as page.log.1.
const pageLogLimit = 1 << 20

/*
pageLogPath is where problems the page saw are written: the Logs folder on
macOS, where Console.app also lists it, and the user cache folder elsewhere.
The page runs in the system web view, whose console nobody sees in a
packaged application; this file is what can be read after a failure.
*/
func pageLogPath() (string, error) {
	if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Logs", appFolder, "page.log"), nil
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, appFolder, "page.log"), nil
}

// LogPageProblem appends one line from the page to the page log. Writing it
// is best effort: a log that cannot be written must not become a second
// failure on top of the one being reported.
func (a *App) LogPageProblem(text string) {
	path, err := pageLogPath()
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	if st, err := os.Stat(path); err == nil && st.Size() > pageLogLimit {
		_ = os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()
	line := strings.ReplaceAll(strings.TrimSpace(text), "\n", " | ")
	_, _ = fmt.Fprintf(f, "%s %s\n", time.Now().Format(time.RFC3339), line)
}
