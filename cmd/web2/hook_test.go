package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// H1: invokesWeb2 must tell "runs web2" apart from "merely names web2".
// A false positive only sets an unused env var; a false negative falls back
// to the shared browser. Both are safe, but the common cases must be right -
// especially `cd <repo>/web2 && ...`, which is not a web2 invocation.
func TestInvokesWeb2(t *testing.T) {
	cases := map[string]bool{
		"web2 go https://example.com": true,
		"web2":                        true,
		"/usr/local/bin/web2 status":  true,
		"WEB2_DEBUG=1 web2 go x":      true,
		"npm test && web2 status":     true,
		"web2 extract links | head":   true,
		"cat f | web2 exec 'x'":       true,
		"foo; web2 status":            true,
		"(cd /tmp && web2 status)":    true,
		"set -e\nweb2 go x":           true,

		"cd /Users/Shared/dev/web2 && npm test": false,
		"ls /opt/web2/bin":                      false,
		"echo web2":                             false,
		"grep -r web2 src/":                     false,
		"# web2 is great\nls":                   false,
		"web2backup status":                     false,
		"myweb2 status":                         false,
		"npm test":                              false,
		"":                                      false,
	}
	for cmd, want := range cases {
		if got := invokesWeb2(cmd); got != want {
			t.Errorf("invokesWeb2(%q) = %v, want %v", cmd, got, want)
		}
	}
}

// hookPayload builds a PreToolUse payload as Claude Code sends it.
func hookPayload(t *testing.T, toolName, agentID, command string) []byte {
	t.Helper()
	payload := map[string]interface{}{
		"hook_event_name": "PreToolUse",
		"tool_name":       toolName,
		"tool_input": map[string]interface{}{
			"command":     command,
			"description": "some description",
			"timeout":     30000,
		},
	}
	if agentID != "" {
		payload["agent_id"] = agentID
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// updatedCommand digs the rewritten command out of a hook response, and
// fails the test if the response is not a well-formed PreToolUse output.
func updatedCommand(t *testing.T, out string) (string, map[string]interface{}) {
	t.Helper()
	var resp struct {
		HookSpecificOutput struct {
			HookEventName      string         `json:"hookEventName"`
			UpdatedInput       map[string]interface{} `json:"updatedInput"`
			PermissionDecision string         `json:"permissionDecision"`
		} `json:"hookSpecificOutput"`
	}
	if err := json.Unmarshal([]byte(out), &resp); err != nil {
		t.Fatalf("response is not valid JSON: %v\n%s", err, out)
	}
	if resp.HookSpecificOutput.HookEventName != "PreToolUse" {
		t.Errorf("hookEventName = %q, want PreToolUse", resp.HookSpecificOutput.HookEventName)
	}
	// The hook rewrites the command; it must never grant permission.
	if resp.HookSpecificOutput.PermissionDecision != "" {
		t.Errorf("hook returned permissionDecision %q - it must never decide permissions",
			resp.HookSpecificOutput.PermissionDecision)
	}
	cmd, _ := resp.HookSpecificOutput.UpdatedInput["command"].(string)
	return cmd, resp.HookSpecificOutput.UpdatedInput
}

// H2: a subagent's web2 call gets its own owner id injected.
func TestHookDecisionInjectsForSubagent(t *testing.T) {
	out := hookDecision(hookPayload(t, "Bash", "a7749ec14e0012632", "web2 go https://example.com"))
	if out == "" {
		t.Fatal("no decision emitted for a subagent web2 call")
	}
	cmd, input := updatedCommand(t, out)
	if want := "export WEB2_AGENT=a7749ec14e0012632; web2 go https://example.com"; cmd != want {
		t.Errorf("command = %q, want %q", cmd, want)
	}
	// Unrelated fields of tool_input must survive the rewrite.
	if input["description"] != "some description" {
		t.Errorf("description lost: %#v", input["description"])
	}
	if _, ok := input["timeout"]; !ok {
		t.Error("timeout lost from updatedInput")
	}
}

// H3: the main session has no agent_id and must keep the shared browser -
// this is the pre-hook behavior and the safe degradation path.
func TestHookDecisionIgnoresMainSession(t *testing.T) {
	if out := hookDecision(hookPayload(t, "Bash", "", "web2 go https://example.com")); out != "" {
		t.Errorf("main session was rewritten: %s", out)
	}
}

// H4: everything web2 has no opinion about must pass through untouched.
func TestHookDecisionPassesThrough(t *testing.T) {
	cases := []struct {
		name    string
		payload []byte
	}{
		{"non-web2 command", hookPayload(t, "Bash", "a123", "npm test")},
		{"non-Bash tool", hookPayload(t, "Read", "a123", "web2 go x")},
		{"explicit WEB2_SESSION wins", hookPayload(t, "Bash", "a123", "WEB2_SESSION=ci web2 go x")},
		{"already carries WEB2_AGENT", hookPayload(t, "Bash", "a123", "export WEB2_AGENT=b; web2 go x")},
		{"malformed json", []byte("{not json")},
		{"empty input", []byte("")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if out := hookDecision(tc.payload); out != "" {
				t.Errorf("expected no decision, got: %s", out)
			}
		})
	}
}

// H5: agent_id lands in a shell command, so anything that is not a plain
// identifier must be refused rather than escaped - degrading to the shared
// browser is safe, injecting shell metacharacters is not.
func TestHookDecisionRejectsUnsafeAgentID(t *testing.T) {
	for _, id := range []string{
		"a123; rm -rf /",
		"$(whoami)",
		"`id`",
		"a b",
		"a'b",
		"a\nb",
		strings.Repeat("a", 200),
	} {
		if out := hookDecision(hookPayload(t, "Bash", id, "web2 go x")); out != "" {
			t.Errorf("unsafe agent_id %q was injected: %s", id, out)
		}
	}
}

// H7: the shipped plugin hook must invoke the command this binary actually
// implements, and must not fail the tool call when web2 is not installed.
func TestPluginHookConfig(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "hooks", "hooks.json"))
	if err != nil {
		t.Fatalf("plugin hook config missing: %v", err)
	}
	var cfg struct {
		Hooks struct {
			PreToolUse []struct {
				Matcher string `json:"matcher"`
				Hooks   []struct {
					Type    string `json:"type"`
					Command string `json:"command"`
				} `json:"hooks"`
			} `json:"PreToolUse"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("hooks.json is not valid JSON: %v", err)
	}
	if len(cfg.Hooks.PreToolUse) != 1 || cfg.Hooks.PreToolUse[0].Matcher != "Bash" {
		t.Fatalf("expected exactly one PreToolUse matcher for Bash, got %#v", cfg.Hooks.PreToolUse)
	}
	entries := cfg.Hooks.PreToolUse[0].Hooks
	if len(entries) != 1 {
		t.Fatalf("expected one hook command, got %d", len(entries))
	}
	command := entries[0].Command
	if !strings.Contains(command, "hook pretooluse") {
		t.Errorf("hook command %q does not call `web2 hook pretooluse`", command)
	}
	// Without this the tool call errors on every Bash use when web2 is absent.
	if !strings.Contains(command, "|| true") {
		t.Errorf("hook command %q must not fail when web2 is not installed", command)
	}
	// The dispatched subcommand must be one cmdHook accepts.
	if out := hookDecision(hookPayload(t, "Bash", "a123", "web2 status")); out == "" {
		t.Error("hookDecision produced nothing for a subagent web2 call")
	}
}

// H6: the injected value must be exactly what ResolveOwner reads back, so a
// subagent's browser is stable across its Bash calls and distinct per agent.
func TestHookInjectionMatchesOwnerResolution(t *testing.T) {
	out := hookDecision(hookPayload(t, "Bash", "agentone", "web2 status"))
	cmd, _ := updatedCommand(t, out)
	prefix := "export WEB2_AGENT="
	value := strings.TrimSuffix(strings.TrimPrefix(strings.SplitN(cmd, ";", 2)[0], prefix), " ")

	one := ResolveOwner(Environment{Getenv: env(map[string]string{
		"WEB2_AGENT": value, "CLAUDE_CODE_SESSION_ID": "shared",
	}), Tree: claudeTree(), UID: 501})
	two := ResolveOwner(Environment{Getenv: env(map[string]string{
		"WEB2_AGENT": "agenttwo", "CLAUDE_CODE_SESSION_ID": "shared",
	}), Tree: claudeTree(), UID: 501})

	if one.Kind != KindSubagent {
		t.Errorf("Kind = %q, want %q", one.Kind, KindSubagent)
	}
	if one.ContainerName() == two.ContainerName() {
		t.Error("two subagents of the same session share a container")
	}
}
