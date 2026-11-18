package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"terra-notation/internal/annotation"
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

func recentFile() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "TERRA-Notation", "recent.json"), nil
}

func readRecent() []RecentProject {
	path, err := recentFile()
	if err != nil {
		return nil
	}
	b, err := os.ReadFile(path)
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
