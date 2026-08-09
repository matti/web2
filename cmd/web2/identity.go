package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Owner identity resolution - the core of web2.
//
// Every invocation derives a stable owner key from the environment instead of
// requiring the caller to remember one. An LLM agent cannot carry state
// between Bash calls (each call runs in a fresh shell with a fresh PID), so
// nothing correctness-critical may depend on caller memory. The chain below
// prefers signals that stay stable for the whole life of the calling agent
// session and degrades gracefully down to per-user granularity.

type OwnerKind string

const (
	KindNamed    OwnerKind = "named"    // WEB2_SESSION - explicit opt-in (humans, CI, tests)
	KindSubagent OwnerKind = "subagent" // WEB2_AGENT - per-subagent id injected by the hook
	KindAgent    OwnerKind = "agent"    // agent harness session uuid from env
	KindProc     OwnerKind = "proc"     // nearest agent ancestor process
	KindTerm     OwnerKind = "term"     // terminal session uuid
	KindTTY      OwnerKind = "tty"      // controlling tty device
	KindUID      OwnerKind = "uid"      // last resort: one browser per user
)

type Owner struct {
	Key  string
	Kind OwnerKind
	// Liveness hint for the reaper: the agent ancestor process observed at
	// resolution time. PID recycling is guarded by comparing StartTime.
	// Zero/empty when no agent ancestor was found.
	PID       int
	StartTime string
}

// ContainerName maps the owner key to a docker container name. Hashed so the
// name never leaks the key and never collides with user-visible words.
func (o Owner) ContainerName() string {
	sum := sha256.Sum256([]byte(o.Key))
	return prefix + hex.EncodeToString(sum[:])[:12]
}

type Process struct {
	PID       int
	PPID      int
	StartTime string // raw `ps -o lstart=` text; compared verbatim, never parsed
	Command   string
}

type ProcTree interface {
	SelfPID() int
	Lookup(pid int) (Process, bool)
}

// Environment carries every input ResolveOwner reads, injected for testability.
type Environment struct {
	Getenv func(string) string
	Tree   ProcTree
	TTY    string // controlling tty device name ("" if none)
	UID    int
}

// agentSessionEnvs: env vars that identify an agent session. Extension point
// for other harnesses - adding support is one line here.
var agentSessionEnvs = []struct{ env, prefix string }{
	{"CLAUDE_CODE_SESSION_ID", "cc"},
}

// agentBinaries: process basenames recognized as long-lived agent processes
// during the ancestor walk.
var agentBinaries = map[string]bool{
	"claude":  true,
	"codex":   true,
	"cursor":  true,
	"copilot": true,
	"aider":   true,
	"gemini":  true,
}

const maxWalkDepth = 15

// ResolveOwner derives the caller's owner identity. First match wins:
//
//  1. WEB2_SESSION            → named    (explicit)
//  2. WEB2_AGENT              → subagent (injected by the PreToolUse hook)
//  3. agent session env vars  → agent    (e.g. CLAUDE_CODE_SESSION_ID)
//  4. ancestor walk           → proc     (nearest known agent binary)
//  5. terminal session id     → term     (ITERM_SESSION_ID / TERM_SESSION_ID)
//  6. controlling tty         → tty
//  7. uid                     → uid
//
// Step 2 exists because every subagent of one harness session inherits the
// same session uuid and the same agent ancestor: from inside a Bash call
// nothing distinguishes them, so steps 3-7 would put them all in one browser
// and they would overwrite each other's pages. The harness does know which
// subagent is calling, and tells the PreToolUse hook (hook.go), which passes
// it down as WEB2_AGENT. Without the hook the chain degrades to the shared
// browser - never to another owner's.
//
// v1's WEB_* variables are deliberately never read (coexistence).
func ResolveOwner(e Environment) Owner {
	getenv := e.Getenv
	if getenv == nil {
		getenv = os.Getenv
	}

	// The agent-ancestor is looked up eagerly: agent-env owners also record
	// it as a liveness hint label on the container.
	ancestor, hasAncestor := findAgentAncestor(e.Tree)

	// withAncestor attaches the liveness hint the reaper and admin surface use.
	withAncestor := func(o Owner) Owner {
		if hasAncestor {
			o.PID = ancestor.PID
			o.StartTime = ancestor.StartTime
		}
		return o
	}

	if v := getenv("WEB2_SESSION"); v != "" {
		return Owner{Key: "named:" + v, Kind: KindNamed}
	}

	if v := getenv("WEB2_AGENT"); validAgentID(v) {
		return withAncestor(Owner{Key: "agent:" + v, Kind: KindSubagent})
	}

	for _, a := range agentSessionEnvs {
		if v := getenv(a.env); v != "" {
			return withAncestor(Owner{Key: a.prefix + ":" + v, Kind: KindAgent})
		}
	}

	if hasAncestor {
		return Owner{
			Key:       "proc:" + strconv.Itoa(ancestor.PID) + ":" + ancestor.StartTime,
			Kind:      KindProc,
			PID:       ancestor.PID,
			StartTime: ancestor.StartTime,
		}
	}

	if v := getenv("ITERM_SESSION_ID"); v != "" {
		return Owner{Key: "term:" + v, Kind: KindTerm}
	}
	if v := getenv("TERM_SESSION_ID"); v != "" {
		return Owner{Key: "term:" + v, Kind: KindTerm}
	}

	if e.TTY != "" {
		return Owner{Key: "tty:" + e.TTY, Kind: KindTTY}
	}

	return Owner{Key: "uid:" + strconv.Itoa(e.UID), Kind: KindUID}
}

// findAgentAncestor walks the ppid chain (bounded, cycle-safe) looking for
// the nearest process whose command basename is a known agent binary.
func findAgentAncestor(tree ProcTree) (Process, bool) {
	if tree == nil {
		return Process{}, false
	}
	seen := map[int]bool{}
	pid := tree.SelfPID()
	for i := 0; i < maxWalkDepth; i++ {
		if pid <= 1 || seen[pid] {
			return Process{}, false
		}
		seen[pid] = true
		p, ok := tree.Lookup(pid)
		if !ok {
			return Process{}, false
		}
		if agentBinaries[commandBasename(p.Command)] {
			return p, true
		}
		pid = p.PPID
	}
	return Process{}, false
}

// commandBasename extracts the executable basename from a full command line.
// "/bin/zsh -c foo" → "zsh"; "-zsh" (login shell) → "zsh";
// "claude --flag" → "claude".
func commandBasename(command string) string {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return ""
	}
	base := filepath.Base(fields[0])
	return strings.TrimPrefix(base, "-")
}

// --- production implementations ---

// psTree reads the process tree by shelling out to ps(1); works on both
// macOS and Linux. StartTime is the raw lstart text (5 space-separated
// fields), used only for equality comparison.
type psTree struct{}

func (psTree) SelfPID() int { return os.Getpid() }

func (psTree) Lookup(pid int) (Process, bool) {
	out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "ppid=,lstart=,command=").Output()
	if err != nil {
		return Process{}, false
	}
	fields := strings.Fields(strings.TrimSpace(string(out)))
	if len(fields) < 7 {
		return Process{}, false
	}
	ppid, err := strconv.Atoi(fields[0])
	if err != nil {
		return Process{}, false
	}
	return Process{
		PID:       pid,
		PPID:      ppid,
		StartTime: strings.Join(fields[1:6], " "),
		Command:   strings.Join(fields[6:], " "),
	}, true
}

// controllingTTY returns the caller's tty device name ("" when detached).
func controllingTTY() string {
	out, err := exec.Command("ps", "-p", strconv.Itoa(os.Getpid()), "-o", "tty=").Output()
	if err != nil {
		return ""
	}
	tty := strings.TrimSpace(string(out))
	if tty == "" || tty == "??" || tty == "?" || tty == "-" {
		return ""
	}
	return tty
}

// currentOwner resolves the owner from the real environment.
func currentOwner() Owner {
	return ResolveOwner(Environment{
		Getenv: os.Getenv,
		Tree:   psTree{},
		TTY:    controllingTTY(),
		UID:    os.Getuid(),
	})
}
