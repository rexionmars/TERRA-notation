//go:build darwin

package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os/exec"
)

/*
captureRegion runs the system's screencapture in interactive mode: the reader
drags a region, or presses Space and clicks a window, or presses Escape to
cancel, in which case no file is written.

macOS asks once for Screen Recording permission for the application that
starts screencapture. Without it the capture holds the desktop and no window
contents; System Settings, Privacy & Security, Screen Recording, turns it on.
*/
func captureRegion(ctx context.Context, file string) error {
	cmd := exec.CommandContext(ctx, "/usr/sbin/screencapture", "-i", "-x", "-o", file)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("screencapture: %w: %s", err, bytes.TrimSpace(stderr.Bytes()))
	}
	return nil
}

/*
clipboardImage reads a PNG from the clipboard through AppleScript, which can
coerce whatever image the clipboard holds (the PNG and TIFF a screenshot
leaves, or the image a browser copies) to PNG. AppleScript prints the data as
«data PNGf<hex>».
*/
func clipboardImage(ctx context.Context) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "/usr/bin/osascript", "-e", "the clipboard as «class PNGf»")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if bytes.Contains(stderr.Bytes(), []byte("-1700")) {
			return nil, errors.New("the clipboard holds no image; copy a screenshot first " +
				"(Control-Shift-Command-4 copies a region)")
		}
		return nil, fmt.Errorf("read the clipboard: %w: %s", err, bytes.TrimSpace(stderr.Bytes()))
	}
	out := bytes.TrimSpace(stdout.Bytes())
	const head = "«data PNGf"
	if !bytes.HasPrefix(out, []byte(head)) || !bytes.HasSuffix(out, []byte("»")) {
		return nil, errors.New("the clipboard image did not come back as PNG data")
	}
	hexPart := out[len(head) : len(out)-len("»")]
	data := make([]byte, hex.DecodedLen(len(hexPart)))
	if _, err := hex.Decode(data, hexPart); err != nil {
		return nil, fmt.Errorf("decode the clipboard image: %w", err)
	}
	return data, nil
}

func reveal(ctx context.Context, path string) error {
	if err := exec.CommandContext(ctx, "/usr/bin/open", "-R", path).Run(); err != nil {
		return fmt.Errorf("show in Finder: %w", err)
	}
	return nil
}
