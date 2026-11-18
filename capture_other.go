//go:build !darwin

package main

import (
	"context"
	"errors"
)

// Screen capture and clipboard images use macOS tools. Elsewhere a
// screenshot reaches a slot as a file, dropped or chosen.
var errMacOnly = errors.New("this works on macOS only; drop the screenshot file on the slot or choose it with File")

func captureRegion(context.Context, string) error { return errMacOnly }

func clipboardImage(context.Context) ([]byte, error) { return nil, errMacOnly }

func reveal(context.Context, string) error { return errMacOnly }
