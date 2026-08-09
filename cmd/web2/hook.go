package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// PreToolUse hook - the missing half of subagent isolation.
//
// Owner identity (identity.go) is derived from the environment, but every
// subagent of one Claude Code session sees an identical environment: same
// CLAUDE_CODE_SESSION_ID, same CLAUDE_PID, same agent ancestor. Measured on
// 2.1.226: two concurrent subagents produced byte-identical env dumps. From
// inside a Bash call there is nothing left to tell them apart, so they all
// resolve to one browser and overwrite each other's pages.
//
// The harness does know who is calling. Its PreToolUse payload carries an
// `agent_id` field for tool calls made by a subagent, and omits it for the
// main session. This hook reads that id and rewrites the Bash command to
// carry it as WEB2_AGENT, which ResolveOwner picks up as the owner key.
//
// Everything web2 has no opinion about passes through untouched: the main
// session, non-Bash tools, commands that do not run web2, and callers who
// already set an owner themselves. The hook never returns a
// permissionDecision - it rewrites the command, it does not approve it.
//
// It runs on every single Bash tool call, so it must stay cheap: read stdin,
// decide, print. main() dispatches it before any docker or rebuild work.

// maxHookPayload bounds the stdin read; real payloads are a few KB.
const maxHookPayload = 1 << 20

func cmdHook(args []string) {
	if len(args) != 1 || args[0] != "pretooluse" {
		fmt.Fprintln(os.Stderr, "Usage: web2 hook pretooluse   (reads a PreToolUse payload on stdin)")
		os.Exit(exitUsage)
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, maxHookPayload))
	if err != nil {
		return // a broken read must never block the tool call
	}
	if out := hookDecision(raw); out != "" {
		fmt.Println(out)
	}
}

// hookDecision returns the JSON response to print, or "" when web2 has no
// opinion about this tool call. Any malformed input yields "": the hook is
// on the critical path of every Bash call and must fail open.
func hookDecision(raw []byte) string {
	var in struct {
		ToolName  string                 `json:"tool_name"`
		AgentID   string                 `json:"agent_id"`
		ToolInput map[string]interface{} `json:"tool_input"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return ""
	}
	// No agent_id means the main session: it keeps the browser it has always
	// had. This is also the degradation path on harnesses that send no id.
	if in.ToolName != "Bash" || !validAgentID(in.AgentID) {
		return ""
	}
	command, ok := in.ToolInput["command"].(string)
	if !ok || !invokesWeb2(command) {
		return ""
	}
	// An owner the caller chose - or a previous rewrite - always wins.
	if strings.Contains(command, "WEB2_SESSION=") || strings.Contains(command, "WEB2_AGENT=") {
		return ""
	}

	// Rewrite the whole tool_input, preserving fields web2 does not know
	// about (description, timeout, run_in_background, ...).
	updated := make(map[string]interface{}, len(in.ToolInput))
	for k, v := range in.ToolInput {
		updated[k] = v
	}
	// A leading `export` survives everything the command may do afterwards -
	// a bare `VAR=x cmd` prefix would only apply to the first command in a
	// chain, and would miss `cd foo && web2 ...` entirely.
	updated["command"] = "export WEB2_AGENT=" + in.AgentID + "; " + command

	out, err := json.Marshal(map[string]interface{}{
		"hookSpecificOutput": map[string]interface{}{
			"hookEventName": "PreToolUse",
			"updatedInput":  updated,
		},
	})
	if err != nil {
		return ""
	}
	return string(out)
}

// validAgentID accepts plain identifiers only. The id is interpolated into a
// shell command, so anything else is refused rather than escaped: degrading
// to the shared browser is safe, a shell injection is not.
func validAgentID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}

// invokesWeb2 reports whether a shell command runs the web2 binary, as
// opposed to merely naming it - `cd ~/dev/web2 && npm test` must not match.
// Only command positions are inspected: the start of the string and whatever
// follows a shell operator, skipping leading VAR=value assignments.
//
// The check is deliberately approximate. A false positive sets an env var
// nothing reads; a false negative leaves the caller on the shared browser.
// Neither can send a command to another owner's browser.
func invokesWeb2(command string) bool {
	if !strings.Contains(command, "web2") {
		return false
	}
	for _, segment := range commandPositions(command) {
		for _, token := range strings.Fields(segment) {
			if isEnvAssignment(token) {
				continue
			}
			if strings.HasPrefix(token, "#") {
				break // a comment: nothing runs here
			}
			if filepath.Base(token) == "web2" {
				return true
			}
			break // this segment runs something else
		}
	}
	return false
}

// commandPositions splits a command on the operators that begin a new one.
func commandPositions(command string) []string {
	return strings.FieldsFunc(command, func(r rune) bool {
		switch r {
		case ';', '&', '|', '\n', '(', ')', '{', '}':
			return true
		}
		return false
	})
}

// isEnvAssignment matches a leading VAR=value token.
func isEnvAssignment(token string) bool {
	eq := strings.IndexByte(token, '=')
	if eq <= 0 {
		return false
	}
	for i, r := range token[:eq] {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '_':
		case i > 0 && r >= '0' && r <= '9':
		default:
			return false
		}
	}
	return true
}
