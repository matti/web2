package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"time"
)

// cmdExec delegates any browser command to the owner's container.
// The full path of every command:
//
//	resolve owner → reap orphans → ensure container → docker exec
//
// with per-command timeout, in-container locking (unless exempt), and
// input/output path bridging for files outside the $HOME bind-mount.
func cmdExec(cmd string, args []string) {
	owner := currentOwner()
	dbg("exec: owner=%s (%s)", owner.Key, owner.Kind)

	cmdArgs := append([]string{cmd}, args...)

	// page tail is long-running - reconnect if the container goes away
	// (e.g. idle-killed while the viewer was open).
	if isReconnectable(cmd, args) {
		execWithReconnect(owner, cmdArgs)
		return
	}

	ctr := ensureContainer(owner)
	dbg("exec: container=%s cmd=%s", ctr, cmd)

	// Copy `do upload` file args that fall outside the home bind-mount INTO
	// the container before exec, so setInputFiles (running in-container) can
	// read them.
	inputs := planInputCopies(cmdArgs)
	if len(inputs) > 0 {
		copyInputs(ctr, inputs)
		defer cleanupInputs(ctr, inputs)
	}

	// Rewrite --output paths that fall outside the home bind-mount so they
	// can still be reached after the command exits via docker cp.
	rewrites := planOutputRewrites(cmdArgs)
	for _, c := range inputs {
		rewrites = append(rewrites, outputRewrite{Host: c.Host, Container: c.Container})
	}

	ctx, cancel, timeout := commandContext(cmd, args)
	defer cancel()

	err := dockerExecCtx(ctx, ctr, cmdArgs, rewrites, isLockExempt(cmd, args))
	copyOutputs(ctr, rewrites)

	if ctx.Err() == context.DeadlineExceeded {
		fmt.Fprintf(os.Stderr, "Error: command timed out after %ds\n", int(timeout.Seconds()))
		os.Exit(exitTimeout)
	}
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			if exitErr.ExitCode() == exitBusy {
				fmt.Fprintln(os.Stderr, busyWaitErrorMessage())
				os.Exit(exitBusy)
			}
			os.Exit(exitErr.ExitCode())
		}
		os.Exit(exitCommand)
	}
	dbg("exec: done")
}

func busyWaitErrorMessage() string {
	lockWait, err := resolveLockWait()
	if err != nil {
		lockWait = defaultLockWait
	}
	return fmt.Sprintf("Error: browser busy - another command is running (waited %ds); retry shortly", lockWait)
}

// commandContext returns the per-command timeout context. Long-running
// streaming commands get no deadline; crawl gets a generous one.
func commandContext(cmd string, args []string) (context.Context, context.CancelFunc, time.Duration) {
	if noTimeout(cmd, args) {
		ctx, cancel := context.WithCancel(context.Background())
		return ctx, cancel, 0
	}
	timeout := time.Duration(envInt("WEB2_CMD_TIMEOUT", 60)) * time.Second
	if cmd == "crawl" {
		crawlTimeout := 600 * time.Second
		if timeout > crawlTimeout {
			crawlTimeout = timeout
		}
		timeout = crawlTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	return ctx, cancel, timeout
}

func noTimeout(cmd string, args []string) bool {
	if cmd == "record" {
		return true
	}
	return cmd == "page" && len(args) > 0 && args[0] == "tail"
}

// isLockExempt: long-running commands that must not hold the in-container
// command lock (they don't compete for tab state).
func isLockExempt(cmd string, args []string) bool {
	return noTimeout(cmd, args)
}

func isReconnectable(cmd string, args []string) bool {
	return cmd == "page" && len(args) > 0 && args[0] == "tail"
}

func execWithReconnect(owner Owner, cmdArgs []string) {
	for {
		ctr := ensureContainer(owner)
		dbg("exec: reconnectable cmd on %s", ctr)
		err := dockerExecCtx(context.Background(), ctr, cmdArgs, nil, true)
		if err == nil {
			return
		}
		// If the user sent SIGINT, exit cleanly
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 130 {
			os.Exit(130)
		}
		fmt.Fprintln(os.Stderr, "[tail] browser gone, restarting...")
		time.Sleep(500 * time.Millisecond)
	}
}
