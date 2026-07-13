package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

//go:embed _bundle.tar.gz
var embeddedBundle []byte

// extractBundle extracts the embedded Docker build context to a temp directory.
// Returns the temp directory path. Caller is responsible for cleanup.
func extractBundle() (string, error) {
	dir, err := os.MkdirTemp("", "web-bundle-*")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}

	gr, err := gzip.NewReader(bytes.NewReader(embeddedBundle))
	if err != nil {
		os.RemoveAll(dir)
		return "", fmt.Errorf("gzip: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			os.RemoveAll(dir)
			return "", fmt.Errorf("tar: %w", err)
		}

		target := filepath.Join(dir, hdr.Name)

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				os.RemoveAll(dir)
				return "", err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				os.RemoveAll(dir)
				return "", err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY, os.FileMode(hdr.Mode))
			if err != nil {
				os.RemoveAll(dir)
				return "", err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				os.RemoveAll(dir)
				return "", err
			}
			f.Close()
		}
	}

	return dir, nil
}
