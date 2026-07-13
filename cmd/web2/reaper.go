package main

import (
	"strconv"
	"strings"
)

// reapOrphans removes web2 containers whose owner is provably gone. Runs
// best-effort at the start of every invocation.
//
// Rules (see web2.md 4.4):
//   - exited containers: always removed (idle/TTL already killed the browser).
//   - running, owner kind "proc": removed when the recorded pid+starttime no
//     longer matches a live process. StartTime comparison guards against PID
//     recycling — v1's mistake was `kill(pid, 0)` which proves nothing.
//   - every other kind (agent/term/tty/uid/named): a uuid's liveness cannot
//     be checked from the host, so the host NEVER reaps them; the
//     in-container idle timeout and TTL handle those.
//
// Filters exclusively on the web2=true label: v1 containers are invisible.
func reapOrphans() {
	out, err := dockerOutputSilent("ps", "-a", "--filter", "label=web2=true", "--format",
		"{{.Names}}\t{{.State}}\t{{.Label \"web2.owner.kind\"}}\t{{.Label \"web2.owner.pid\"}}\t{{.Label \"web2.owner.starttime\"}}")
	if err != nil || strings.TrimSpace(out) == "" {
		return
	}
	tree := psTree{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Split(line, "\t")
		if len(parts) < 5 {
			continue
		}
		name, state, kind, pidStr, startTime := parts[0], parts[1], parts[2], parts[3], parts[4]

		if state != "running" {
			dbg("reap: removing stopped %s", name)
			dockerOutputSilent("rm", "-f", name)
			continue
		}
		if OwnerKind(kind) != KindProc || pidStr == "" {
			continue
		}
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}
		p, ok := tree.Lookup(pid)
		if !ok || p.StartTime != startTime {
			dbg("reap: removing orphan %s (proc %d gone or recycled)", name, pid)
			dockerOutputSilent("rm", "-f", name)
		}
	}
}
