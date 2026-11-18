package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"terra-point-check/internal/annotation"
)

// RecentProject is one entry of the start screen's list.
type RecentProject struct {
	Dir      string `json:"dir"`
	Name     string `json:"name"`
	OpenedAt string `json:"opened_at"`
	// Exists is false when the folder no longer holds the project.
	Exists bool `json:"exists"`
}

const maxRecent = 12

/*
appFolder names the application's folders under the user's configuration,
cache and log folders. legacyAppFolder is the name the application had
before (TERRA Notation): its recent list is read until the first project
opened under the new name writes one of its own.
*/
const (
	appFolder       = "TERRA-Point-Check"
	legacyAppFolder = "TERRA-Notation"
)

func recentFileIn(folder string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, folder, "recent.json"), nil
}

func recentFile() (string, error) { return recentFileIn(appFolder) }

func readRecent() []RecentProject {
	path, err := recentFile()
	if err != nil {
		return nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		if legacy, lerr := recentFileIn(legacyAppFolder); lerr == nil {
			b, err = os.ReadFile(legacy)
		}
	}
	if err != nil {
		return nil
	}
	var out []RecentProject
	if json.Unmarshal(b, &out) != nil {
		return nil
	}
	return out
}

/*
rememberProject puts a project at the top of the recent list. The list is a
convenience: failing to write it loses nothing the project holds, so its
errors are not reported.
*/
func rememberProject(dir, name string) {
	path, err := recentFile()
	if err != nil {
		return
	}
	list := []RecentProject{{Dir: dir, Name: name, OpenedAt: time.Now().UTC().Format(time.RFC3339)}}
	for _, r := range readRecent() {
		if r.Dir != dir && len(list) < maxRecent {
			list = append(list, r)
		}
	}
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return
	}
	if os.MkdirAll(filepath.Dir(path), 0o755) == nil {
		_ = os.WriteFile(path, b, 0o644)
	}
}

// RecentProjects lists the projects opened most recently.
func (a *App) RecentProjects() []RecentProject {
	list := readRecent()
	for i := range list {
		_, err := os.Stat(filepath.Join(list[i].Dir, annotation.DBFile))
		list[i].Exists = err == nil
	}
	if list == nil {
		return []RecentProject{}
	}
	return list
}
