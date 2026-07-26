package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// containerRunning checks if a container with the given name is running.
func containerRunning(name string) bool {
	out, err := dockerOutputSilent("ps", "-q", "--filter", fmt.Sprintf("name=^%s$", name))
	return err == nil && strings.TrimSpace(out) != ""
}

// dockerProbe is the seam tests swap to drive the docker helpers below.
var dockerProbe = dockerOutputSilent

// imageExists reports whether a local image with the given ref exists.
//
// The exit status is the signal, not stdout: `docker image inspect` prints
// "[]" to stdout and exits non-zero when the image is missing, so a non-empty
// stdout is not proof of existence. --format keeps stdout empty in that case
// too, and reduces a hit to a bare image ID.
func imageExists(ref string) bool {
	out, err := dockerProbe("image", "inspect", "--format", "{{.Id}}", ref)
	return err == nil && strings.TrimSpace(out) != ""
}

// dockerRun runs a docker command, inheriting stdout/stderr.
func dockerRun(args ...string) error {
	cmd := exec.Command("docker", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	return cmd.Run()
}

// dockerOutput runs a docker command and returns stdout.
func dockerOutput(args ...string) (string, error) {
	cmd := exec.Command("docker", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	return out.String(), err
}

// dockerOutputSilent runs a docker command and returns stdout, suppressing stderr.
func dockerOutputSilent(args ...string) (string, error) {
	cmd := exec.Command("docker", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	err := cmd.Run()
	return out.String(), err
}

// dockerExec runs a command inside a container with default settings.
func dockerExec(container string, cmdArgs []string) error {
	return dockerExecCtx(context.Background(), container, cmdArgs, nil, false)
}

// dockerExecCtx runs a command inside a container.
//
//   - ctx carries the per-command timeout (the process is killed on deadline).
//   - rewrites substitute container sentinel paths with host paths on
//     stdout/stderr so user-visible messages show the path the user typed.
//     When rewrites are present, TTY mode is off so the streams stay separable.
//   - noLock exempts long-running commands (record, page tail) from the
//     in-container command lock.
//
// Host-facing env is WEB2_*; the container keeps v1's WEB_* names so the
// in-container code stays byte-identical — the mapping happens here.
func dockerExecCtx(ctx context.Context, container string, cmdArgs []string, rewrites []outputRewrite, noLock bool) error {
	args := []string{"exec"}
	if isTerminal(os.Stdin) {
		args = append(args, "-i")
	}
	if isTerminal(os.Stdout) && len(rewrites) == 0 {
		args = append(args, "-t")
	}
	// Forward terminal identity so commands can detect iTerm2, etc.
	if tp := os.Getenv("TERM_PROGRAM"); tp != "" {
		args = append(args, "-e", "TERM_PROGRAM="+tp)
	}
	if debug {
		args = append(args, "-e", "WEB_DEBUG=1")
	}
	// WEB2_TAB_ID lets parallel callers within one owner select their own tab
	// by target ID (advanced, undocumented in the skill).
	if v := os.Getenv("WEB2_TAB_ID"); v != "" {
		args = append(args, "-e", "WEB_TAB_ID="+v)
	}
	if noLock {
		args = append(args, "-e", "WEB_NO_LOCK=1")
	}
	args = append(args, "-w", containerWorkdir(), container, "web2")
	args = append(args, cmdArgs...)

	cmd := exec.CommandContext(ctx, "docker", args...)
	if len(rewrites) > 0 {
		cmd.Stdout = &rewriteWriter{inner: os.Stdout, rewrites: rewrites}
		cmd.Stderr = &rewriteWriter{inner: os.Stderr, rewrites: rewrites}
	} else {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}
	cmd.Stdin = os.Stdin
	return cmd.Run()
}

// containerWorkdir picks the exec working directory. Only $HOME is
// bind-mounted into the container, so a host cwd outside home does not
// exist there: fall back to $HOME (relative --output paths outside home
// are bridged by the rewrite machinery regardless).
func containerWorkdir() string {
	cwd, err := os.Getwd()
	home, _ := os.UserHomeDir()
	if err != nil || home == "" {
		return "/"
	}
	return workdirUnderHome(cwd, home, filepath.EvalSymlinks)
}

// workdirUnderHome decides on the PHYSICAL path, because that is what the
// container sees under the $HOME mount. os.Getwd honors $PWD and so hands
// back the logical path, and a logical path like $HOME/dev may be a symlink
// pointing clean out of home (e.g. to /Users/Shared/dev). Such a path passes
// a plain prefix test yet does not exist in the container, and docker exec
// fails with `chdir to cwd ... no such file or directory`.
//
// The answer is phrased with the literal home prefix rather than its resolved
// form, since the bind mount uses the literal path on both sides.
func workdirUnderHome(cwd, home string, resolve func(string) (string, error)) string {
	realCwd, err := resolve(cwd)
	if err != nil {
		return home
	}
	realHome, err := resolve(home)
	if err != nil {
		realHome = home
	}
	if realCwd == realHome {
		return home
	}
	if suffix := strings.TrimPrefix(realCwd, realHome+string(os.PathSeparator)); suffix != realCwd {
		return home + string(os.PathSeparator) + suffix
	}
	return home
}

// isTerminal checks if a file descriptor is a terminal. /dev/null is a
// character device but NOT a terminal — treating it as one made the binary
// pass -i/-t to docker exec, which then died with "the input device is not
// a TTY" whenever a command ran with output redirected to /dev/null.
func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil || fi.Mode()&os.ModeCharDevice == 0 {
		return false
	}
	if null, err := os.Stat(os.DevNull); err == nil && os.SameFile(fi, null) {
		return false
	}
	return true
}
