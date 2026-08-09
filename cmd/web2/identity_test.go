package main

import (
	"regexp"
	"testing"
)

// fakeTree is an in-memory ProcTree for table tests.
type fakeTree struct {
	self  int
	procs map[int]Process
}

func (t fakeTree) SelfPID() int                  { return t.self }
func (t fakeTree) Lookup(pid int) (Process, bool) { p, ok := t.procs[pid]; return p, ok }

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

// tree: web2(100) <- zsh(90) <- claude(80) <- zsh(70) <- login(60)
func claudeTree() fakeTree {
	return fakeTree{self: 100, procs: map[int]Process{
		100: {PID: 100, PPID: 90, StartTime: "Mon Jul 13 10:05:00 2026", Command: "web2 go example.com"},
		90:  {PID: 90, PPID: 80, StartTime: "Mon Jul 13 10:05:00 2026", Command: "/bin/zsh -c ..."},
		80:  {PID: 80, PPID: 70, StartTime: "Mon Jul 13 09:58:20 2026", Command: "claude --dangerously-skip-permissions"},
		70:  {PID: 70, PPID: 60, StartTime: "Mon Jul 13 09:58:19 2026", Command: "-zsh"},
		60:  {PID: 60, PPID: 1, StartTime: "Mon Jul  6 21:10:58 2026", Command: "/usr/bin/login -fpl matti"},
	}}
}

// tree with no agent binary anywhere
func plainTree() fakeTree {
	return fakeTree{self: 100, procs: map[int]Process{
		100: {PID: 100, PPID: 90, StartTime: "a", Command: "web2 go example.com"},
		90:  {PID: 90, PPID: 60, StartTime: "b", Command: "/bin/zsh"},
		60:  {PID: 60, PPID: 1, StartTime: "c", Command: "/usr/bin/login"},
	}}
}

func TestResolveOwner(t *testing.T) {
	cases := []struct {
		name     string
		env      map[string]string
		tree     fakeTree
		tty      string
		wantKey  string
		wantKind OwnerKind
	}{
		{
			// U1: explicit name wins over agent env
			name:     "U1 WEB2_SESSION wins",
			env:      map[string]string{"WEB2_SESSION": "ci", "CLAUDE_CODE_SESSION_ID": "x"},
			tree:     claudeTree(),
			wantKey:  "named:ci",
			wantKind: KindNamed,
		},
		{
			// U1b: explicit name also wins over the injected subagent id
			name:     "U1b WEB2_SESSION wins over WEB2_AGENT",
			env:      map[string]string{"WEB2_SESSION": "ci", "WEB2_AGENT": "a7749ec1"},
			tree:     claudeTree(),
			wantKey:  "named:ci",
			wantKind: KindNamed,
		},
		{
			// U2: agent session env
			name:     "U2 CLAUDE_CODE_SESSION_ID",
			env:      map[string]string{"CLAUDE_CODE_SESSION_ID": "83a6bc37-696d"},
			tree:     claudeTree(),
			wantKey:  "cc:83a6bc37-696d",
			wantKind: KindAgent,
		},
		{
			// U2b: subagents share the harness session id, so the per-agent id
			// injected by the PreToolUse hook must outrank it - otherwise every
			// subagent of one session lands in the same browser.
			name: "U2b WEB2_AGENT wins over CLAUDE_CODE_SESSION_ID",
			env: map[string]string{
				"WEB2_AGENT": "a7749ec14e0012632", "CLAUDE_CODE_SESSION_ID": "83a6bc37-696d",
			},
			tree:     claudeTree(),
			wantKey:  "agent:a7749ec14e0012632",
			wantKind: KindSubagent,
		},
		{
			// U3: ancestor walk finds claude at depth 2
			name:     "U3 ancestor claude",
			env:      map[string]string{},
			tree:     claudeTree(),
			wantKey:  "proc:80:Mon Jul 13 09:58:20 2026",
			wantKind: KindProc,
		},
		{
			// U5: no agent ancestor, terminal session id
			name:     "U5 ITERM_SESSION_ID",
			env:      map[string]string{"ITERM_SESSION_ID": "w1t0p1:96C1"},
			tree:     plainTree(),
			wantKey:  "term:w1t0p1:96C1",
			wantKind: KindTerm,
		},
		{
			// U5b: TERM_SESSION_ID also accepted
			name:     "U5b TERM_SESSION_ID",
			env:      map[string]string{"TERM_SESSION_ID": "abc-123"},
			tree:     plainTree(),
			wantKey:  "term:abc-123",
			wantKind: KindTerm,
		},
		{
			// U6: tty fallback
			name:     "U6 tty",
			env:      map[string]string{},
			tree:     plainTree(),
			tty:      "ttys004",
			wantKey:  "tty:ttys004",
			wantKind: KindTTY,
		},
		{
			// U7: uid as last resort
			name:     "U7 uid",
			env:      map[string]string{},
			tree:     plainTree(),
			wantKey:  "uid:501",
			wantKind: KindUID,
		},
		{
			// U11: v1's WEB_SESSION must NOT affect web2
			name:     "U11 v1 WEB_SESSION ignored",
			env:      map[string]string{"WEB_SESSION": "v1-thing"},
			tree:     plainTree(),
			wantKey:  "uid:501",
			wantKind: KindUID,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			o := ResolveOwner(Environment{Getenv: env(tc.env), Tree: tc.tree, TTY: tc.tty, UID: 501})
			if o.Key != tc.wantKey {
				t.Errorf("Key = %q, want %q", o.Key, tc.wantKey)
			}
			if o.Kind != tc.wantKind {
				t.Errorf("Kind = %q, want %q", o.Kind, tc.wantKind)
			}
		})
	}
}

// U4: same PID, different start time (recycled PID) → different key
func TestResolveOwnerPIDRecycling(t *testing.T) {
	tree1 := claudeTree()
	tree2 := claudeTree()
	p := tree2.procs[80]
	p.StartTime = "Tue Jul 14 08:00:00 2026"
	tree2.procs[80] = p

	o1 := ResolveOwner(Environment{Getenv: env(nil), Tree: tree1, UID: 501})
	o2 := ResolveOwner(Environment{Getenv: env(nil), Tree: tree2, UID: 501})
	if o1.Key == o2.Key {
		t.Errorf("recycled PID produced same key %q", o1.Key)
	}
}

// U3b: proc owner carries PID and StartTime for the reaper
func TestResolveOwnerProcMetadata(t *testing.T) {
	o := ResolveOwner(Environment{Getenv: env(nil), Tree: claudeTree(), UID: 501})
	if o.PID != 80 || o.StartTime != "Mon Jul 13 09:58:20 2026" {
		t.Errorf("proc metadata = (%d, %q)", o.PID, o.StartTime)
	}
}

// Agent-env owner also records ancestor liveness hint when available.
func TestResolveOwnerAgentLivenessHint(t *testing.T) {
	o := ResolveOwner(Environment{
		Getenv: env(map[string]string{"CLAUDE_CODE_SESSION_ID": "x"}),
		Tree:   claudeTree(), UID: 501,
	})
	if o.Kind != KindAgent {
		t.Fatalf("Kind = %q", o.Kind)
	}
	if o.PID != 80 || o.StartTime != "Mon Jul 13 09:58:20 2026" {
		t.Errorf("liveness hint = (%d, %q), want claude ancestor", o.PID, o.StartTime)
	}
}

// Subagent owners carry the same ancestor liveness hint as agent owners, so
// admin can show who a browser belongs to.
func TestResolveOwnerSubagentLivenessHint(t *testing.T) {
	o := ResolveOwner(Environment{
		Getenv: env(map[string]string{"WEB2_AGENT": "a7749ec1"}),
		Tree:   claudeTree(), UID: 501,
	})
	if o.Kind != KindSubagent {
		t.Fatalf("Kind = %q", o.Kind)
	}
	if o.PID != 80 || o.StartTime != "Mon Jul 13 09:58:20 2026" {
		t.Errorf("liveness hint = (%d, %q), want claude ancestor", o.PID, o.StartTime)
	}
}

// Two subagents of one session must never resolve to the same browser - this
// is the whole point of the hook.
func TestResolveOwnerSubagentsAreDistinct(t *testing.T) {
	shared := "83a6bc37-696d"
	a := ResolveOwner(Environment{Getenv: env(map[string]string{
		"WEB2_AGENT": "aaa", "CLAUDE_CODE_SESSION_ID": shared,
	}), Tree: claudeTree(), UID: 501})
	b := ResolveOwner(Environment{Getenv: env(map[string]string{
		"WEB2_AGENT": "bbb", "CLAUDE_CODE_SESSION_ID": shared,
	}), Tree: claudeTree(), UID: 501})
	parent := ResolveOwner(Environment{Getenv: env(map[string]string{
		"CLAUDE_CODE_SESSION_ID": shared,
	}), Tree: claudeTree(), UID: 501})

	names := map[string]string{
		a.ContainerName(): "subagent a", b.ContainerName(): "subagent b",
		parent.ContainerName(): "parent",
	}
	if len(names) != 3 {
		t.Errorf("expected 3 distinct browsers, got %d: %v", len(names), names)
	}
}

// U8: cycle in ppid chain terminates and falls through
func TestResolveOwnerCycle(t *testing.T) {
	tree := fakeTree{self: 100, procs: map[int]Process{
		100: {PID: 100, PPID: 90, Command: "web2"},
		90:  {PID: 90, PPID: 80, Command: "/bin/zsh"},
		80:  {PID: 80, PPID: 90, Command: "/bin/bash"}, // cycle 90<->80
	}}
	o := ResolveOwner(Environment{Getenv: env(nil), Tree: tree, UID: 501})
	if o.Key != "uid:501" {
		t.Errorf("cycle: Key = %q, want uid fallback", o.Key)
	}
}

// U9: very deep chain without a match terminates at maxWalkDepth
func TestResolveOwnerDeepChain(t *testing.T) {
	procs := map[int]Process{}
	for i := 0; i < 100; i++ {
		procs[100+i] = Process{PID: 100 + i, PPID: 100 + i + 1, Command: "/bin/sh"}
	}
	tree := fakeTree{self: 100, procs: procs}
	o := ResolveOwner(Environment{Getenv: env(nil), Tree: tree, UID: 501})
	if o.Key != "uid:501" {
		t.Errorf("deep chain: Key = %q, want uid fallback", o.Key)
	}
}

// U10: container names are deterministic, well-formed, and distinct per key
func TestContainerName(t *testing.T) {
	a := Owner{Key: "cc:aaa"}
	b := Owner{Key: "cc:bbb"}
	re := regexp.MustCompile(`^web2-[0-9a-f]{12}$`)
	if !re.MatchString(a.ContainerName()) {
		t.Errorf("malformed name %q", a.ContainerName())
	}
	if a.ContainerName() != a.ContainerName() {
		t.Errorf("not deterministic")
	}
	if a.ContainerName() == b.ContainerName() {
		t.Errorf("different keys collided")
	}
}
