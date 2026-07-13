package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// inputCopy maps a host file path (what the user typed, e.g. /tmp/x.pdf) to a
// sentinel path inside the container under /state. We docker-cp the file IN
// before the command runs so Playwright's setInputFiles — which executes
// inside the container — can read it.
//
// This is the mirror image of outputRewrite: the container only bind-mounts
// $HOME, so a file outside home (notably /tmp) is invisible to the container
// and must be copied across.
type inputCopy struct {
	Host      string // absolute host path
	Container string // sentinel path inside container, under /state
}

// planInputCopies scans `do upload` args for file paths that fall outside the
// home bind-mount. For each, it rewrites the arg in-place to a container
// sentinel under /state and returns the mapping so the caller can docker-cp
// the file in before exec. Files already under $HOME are reachable through the
// existing mount and are left untouched.
//
// Layout of upload args: do upload <selector> <file...>. The first non-flag
// positional after the verb is the selector; the rest are files.
func planInputCopies(args []string) []inputCopy {
	if len(args) < 2 || args[0] != "do" || args[1] != "upload" {
		return nil
	}

	var copies []inputCopy
	positional := 0
	for i := 2; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") {
			continue // flag (e.g. --timeout); its value is consumed as positional below only if not a flag
		}
		positional++
		if positional == 1 {
			continue // selector, not a file
		}
		// File path argument.
		abs, err := filepath.Abs(a)
		if err != nil {
			continue
		}
		if !pathNeedsRewrite(abs) {
			continue // under $HOME — reachable via bind-mount, no copy needed
		}
		ext := filepath.Ext(abs)
		ctn := fmt.Sprintf("/state/.web-in-%d-%d%s", os.Getpid(), i, ext)
		copies = append(copies, inputCopy{Host: abs, Container: ctn})
		args[i] = ctn
	}
	return copies
}

// copyInputs validates each host file exists, then docker-cps it into the
// container at its sentinel path. Dies with a clear error if a file is missing
// or the copy fails, since uploading a non-existent file is never intended.
func copyInputs(container string, copies []inputCopy) {
	for _, c := range copies {
		if _, err := os.Stat(c.Host); err != nil {
			die("file not found: %s", c.Host)
		}
		cp := exec.Command("docker", "cp", c.Host, container+":"+c.Container)
		cp.Stderr = io.Discard
		if err := cp.Run(); err != nil {
			die("could not copy %s into session: %v", c.Host, err)
		}
	}
}

// cleanupInputs removes the sentinel files from the container after exec.
func cleanupInputs(container string, copies []inputCopy) {
	for _, c := range copies {
		_ = exec.Command("docker", "exec", container, "rm", "-f", c.Container).Run()
	}
}
