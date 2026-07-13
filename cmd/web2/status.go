package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// cmdStatus reports the owner's browser state. This is the only command that
// does NOT lazily start the browser — asking "where am I" must be free.
func cmdStatus(args []string) {
	jsonMode := false
	for _, a := range args {
		switch a {
		case "--json":
			jsonMode = true
		case "-h", "--help":
			fmt.Println("Usage: web2 status [--json]")
			os.Exit(0)
		}
	}

	owner := currentOwner()
	ctr := owner.ContainerName()

	if !containerRunning(ctr) {
		if jsonMode {
			fmt.Println(`{"ok":true,"running":false}`)
		} else {
			fmt.Println("no browser running — one starts automatically on your first command")
		}
		return
	}

	uptime := containerUptime(ctr)

	if jsonMode {
		// Merge in-container facts with host-level facts into one object.
		var out bytes.Buffer
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "docker", "exec", ctr, "web2", "status", "--json")
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			fmt.Println(`{"ok":true,"running":true}`)
			return
		}
		var merged map[string]any
		if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &merged); err != nil {
			fmt.Println(`{"ok":true,"running":true}`)
			return
		}
		merged["running"] = true
		merged["uptime"] = uptime
		merged["idleTimeout"] = envInt("WEB2_IDLE_TIMEOUT", 300)
		merged["ttl"] = envInt("WEB2_TTL", 14400)
		b, _ := json.Marshal(merged)
		fmt.Println(string(b))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = dockerExecCtx(ctx, ctr, []string{"status"}, nil, false)
	fmt.Printf("uptime:   %s\n", uptime)
	fmt.Printf("timeouts: idle %ds, ttl %ds\n", envInt("WEB2_IDLE_TIMEOUT", 300), envInt("WEB2_TTL", 14400))
}

func containerUptime(ctr string) string {
	out, err := dockerOutputSilent("inspect", "--format", "{{.State.StartedAt}}", ctr)
	if err != nil {
		return "unknown"
	}
	t, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(out))
	if err != nil {
		return "unknown"
	}
	return time.Since(t).Round(time.Second).String()
}

// cmdReset destroys the owner's browser and starts a fresh one. Destroying
// the whole container is the simplest mechanism that guarantees 100% clean
// state (cookies, storage, tabs, recordings) — and it can only ever touch
// the caller's own world.
func cmdReset(args []string) {
	for _, a := range args {
		if a == "-h" || a == "--help" {
			fmt.Println("Usage: web2 reset")
			fmt.Println("Replace this browser with a completely fresh one")
			os.Exit(0)
		}
	}
	owner := currentOwner()
	ctr := owner.ContainerName()
	dockerOutputSilent("rm", "-f", ctr)
	ensureContainer(owner)
}
