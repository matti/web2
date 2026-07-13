package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// outputRewrite maps a host destination (what the user typed in --output)
// to a sentinel path inside the container. Container code writes to the
// sentinel; we docker-cp it out after the command exits.
type outputRewrite struct {
	Host      string // user-facing absolute path on host
	Container string // sentinel path inside container, under /state
}

// planOutputRewrites scans args for --output values that won't reach the
// host through the existing bind-mount (only $HOME is mounted into the
// container). For each such arg, it rewrites the slice in-place to a
// container-private sentinel and returns the mapping so the caller can
// docker-cp the file out afterward.
//
// We intentionally do NOT bind-mount host /tmp into the container's /tmp:
// it collides on /tmp/.X99-lock and /tmp/.X11-unix between concurrent
// sessions, breaking Xvfb.
func planOutputRewrites(args []string) []outputRewrite {
	var rewrites []outputRewrite
	for i := 0; i < len(args); i++ {
		a := args[i]

		var hostPath string
		var inlineForm bool
		var valueIdx int

		switch {
		case a == "--output" || a == "-o":
			if i+1 >= len(args) {
				continue
			}
			hostPath = args[i+1]
			valueIdx = i + 1
		case strings.HasPrefix(a, "--output="):
			hostPath = strings.TrimPrefix(a, "--output=")
			valueIdx = i
			inlineForm = true
		default:
			continue
		}

		if !pathNeedsRewrite(hostPath) {
			continue
		}
		abs, err := filepath.Abs(hostPath)
		if err != nil {
			continue
		}

		// Sentinel path in container's private /state. Include the original
		// extension so commands that branch on suffix (.png, .pdf, .md) keep
		// working unchanged.
		ext := filepath.Ext(abs)
		ctn := fmt.Sprintf("/state/.web-out-%d-%d%s", os.Getpid(), i, ext)

		if inlineForm {
			args[valueIdx] = "--output=" + ctn
		} else {
			args[valueIdx] = ctn
		}
		rewrites = append(rewrites, outputRewrite{Host: abs, Container: ctn})
	}
	return rewrites
}

// pathNeedsRewrite reports whether a host path falls outside the bind-mount
// the container can write through. The current bind-mount is the user's
// home directory; everything else (notably /tmp) needs post-exec copy-out.
func pathNeedsRewrite(p string) bool {
	if p == "" {
		return false
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return false
	}
	home, _ := os.UserHomeDir()
	if home != "" && (abs == home || strings.HasPrefix(abs, home+string(os.PathSeparator))) {
		return false
	}
	return true
}

// rewriteWriter substitutes container sentinel paths with host paths on
// the way to the user's terminal, so messages like "Saved to /state/..."
// appear as "Saved to /tmp/foo.md".
type rewriteWriter struct {
	inner    io.Writer
	rewrites []outputRewrite
}

func (w *rewriteWriter) Write(p []byte) (int, error) {
	if len(w.rewrites) == 0 {
		return w.inner.Write(p)
	}
	s := string(p)
	for _, r := range w.rewrites {
		s = strings.ReplaceAll(s, r.Container, r.Host)
	}
	if _, err := w.inner.Write([]byte(s)); err != nil {
		return 0, err
	}
	return len(p), nil
}

// copyOutputs docker-cps each rewritten container path to its host
// destination, then removes the sentinel inside the container. Best-effort:
// if the command failed before writing, the cp will fail and we move on.
func copyOutputs(container string, rewrites []outputRewrite) {
	for _, r := range rewrites {
		if err := os.MkdirAll(filepath.Dir(r.Host), 0o755); err != nil {
			fmt.Fprintf(os.Stderr, "web: mkdir %s: %v\n", filepath.Dir(r.Host), err)
			continue
		}
		cp := exec.Command("docker", "cp", container+":"+r.Container, r.Host)
		cp.Stderr = io.Discard
		if err := cp.Run(); err != nil {
			// File may not exist if the underlying command failed first.
			continue
		}
		_ = exec.Command("docker", "exec", container, "rm", "-f", r.Container).Run()
	}
}
