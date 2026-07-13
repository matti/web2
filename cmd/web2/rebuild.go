package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// maybeRebuild checks if the Go source or bundled files are newer than the
// running binary. If so, rebuilds the bundle, recompiles, and re-execs.
// Only triggers from the project dir (dev convenience, no-op for users).
func maybeRebuild() {
	if os.Getenv("WEB2_NO_REBUILD") != "" {
		return
	}

	root, err := findProjectRoot()
	if err != nil {
		return
	}

	binPath, err := os.Executable()
	if err != nil {
		return
	}
	binPath, err = filepath.EvalSymlinks(binPath)
	if err != nil {
		return
	}

	binInfo, err := os.Stat(binPath)
	if err != nil {
		return
	}
	binTime := binInfo.ModTime()

	needsBuild := false

	srcDir := filepath.Join(root, "cmd", "web2")
	if entries, err := os.ReadDir(srcDir); err == nil {
		for _, e := range entries {
			if filepath.Ext(e.Name()) != ".go" {
				continue
			}
			if info, err := e.Info(); err == nil && info.ModTime().After(binTime) {
				needsBuild = true
				break
			}
		}
	}

	if !needsBuild {
		needsBuild = anyNewerThan(root, binTime,
			"docker/Dockerfile", "docker/entrypoint.sh", "docker/web2-wrapper.sh",
			"package.json", "package-lock.json", "tsconfig.json",
		)
	}
	if !needsBuild {
		needsBuild = dirNewerThan(filepath.Join(root, "src"), binTime)
	}

	if !needsBuild {
		return
	}

	dbg("rebuild: source newer than binary, rebundling")
	bundleCmd := exec.Command("tar", "czf",
		filepath.Join(srcDir, "_bundle.tar.gz"),
		"docker/Dockerfile", "docker/entrypoint.sh", "docker/web2-wrapper.sh",
		"package.json", "package-lock.json", "tsconfig.json", "src/",
	)
	bundleCmd.Dir = root
	bundleCmd.Stderr = os.Stderr
	if err := bundleCmd.Run(); err != nil {
		dbg("rebuild: bundle failed: %v", err)
		return
	}

	dbg("rebuild: recompiling")
	buildCmd := exec.Command("go", "build", "-o", binPath, ".")
	buildCmd.Dir = srcDir
	buildCmd.Stdout = os.Stderr
	buildCmd.Stderr = os.Stderr
	if err := buildCmd.Run(); err != nil {
		dbg("rebuild: failed: %v", err)
		return
	}
	dbg("rebuild: done, re-executing")

	os.Setenv("WEB2_NO_REBUILD", "1")
	syscall.Exec(binPath, os.Args, os.Environ())
}

// anyNewerThan checks if any of the given paths (relative to root) are newer than t.
func anyNewerThan(root string, t time.Time, paths ...string) bool {
	for _, p := range paths {
		if info, err := os.Stat(filepath.Join(root, p)); err == nil && info.ModTime().After(t) {
			return true
		}
	}
	return false
}

// dirNewerThan checks if any file in a directory tree is newer than t.
func dirNewerThan(dir string, t time.Time) bool {
	newer := false
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || newer {
			return filepath.SkipDir
		}
		if !d.IsDir() {
			if info, err := d.Info(); err == nil && info.ModTime().After(t) {
				newer = true
				return filepath.SkipDir
			}
		}
		return nil
	})
	return newer
}
