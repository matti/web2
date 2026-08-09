#!/usr/bin/env bash
# Docker e2e for web2's core promises, against real containers:
#   T1 isolation, T2 memorylessness, T3 idle-kill + revive, T6 lock busy,
#   T7 admin agent-gate, T10 session cap, T11 status/reset.
# Run via: ./e2e/run.sh --docker   (budget: 120s)
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO_DIR/cmd/web2/web2-e2e-bin"
PASS=0
FAIL=0

say()  { echo "  $1"; }
ok()   { PASS=$((PASS+1)); say "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); say "FAIL: $1"; }
check() { # check <desc> <expr...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}

# Fake agent identities. WEB2_PROJECT_ROOT points away from the repo so dev
# mounts are off and commands use the compiled JS baked into the image.
BASE_ENV=(WEB2_NO_REBUILD=1 WEB2_PROJECT_ROOT=/nonexistent WEB2_DEBUG=)
A=(env "${BASE_ENV[@]}" CLAUDE_CODE_SESSION_ID=web2-e2e-A "$BIN")
B=(env "${BASE_ENV[@]}" CLAUDE_CODE_SESSION_ID=web2-e2e-B "$BIN")

remove_test_containers() {
  docker ps -aq --filter "label=web2=true" | while read -r id; do
    key=$(docker inspect --format '{{index .Config.Labels "web2.owner.key"}}' "$id" 2>/dev/null)
    case "$key" in cc:web2-e2e-*|agent:web2e2esub*) docker rm -f "$id" >/dev/null 2>&1 ;; esac
  done
}
cleanup() {
  remove_test_containers
  rm -f "$BIN"
}
trap cleanup EXIT
remove_test_containers 2>/dev/null || true

(cd "$REPO_DIR/cmd/web2" && go build -o "$BIN" .) || { echo "FAIL: go build"; exit 1; }

ctr_of_key() { docker ps -q --filter "label=web2.owner.key=$1" | head -1; }
ctr_of()     { ctr_of_key "cc:$1"; }

# --- T2: memorylessness - 3 separate processes, same browser, state persists
"${A[@]}" exec "globalThis.x = 42" >/dev/null 2>&1
out=$("${A[@]}" exec "globalThis.x" 2>/dev/null)
[ "$out" = "42" ] && ok "T2 same browser across processes (x=$out)" || bad "T2 expected 42, got '$out'"
ctrA1=$(ctr_of web2-e2e-A)
"${A[@]}" exec "1" >/dev/null 2>&1
ctrA2=$(ctr_of web2-e2e-A)
[ -n "$ctrA1" ] && [ "$ctrA1" = "$ctrA2" ] && ok "T2 container reused" || bad "T2 container changed: $ctrA1 vs $ctrA2"

# --- T1: isolation - B gets its own browser, cannot see A's state
"${A[@]}" exec "globalThis.secret = 'AAA'" >/dev/null 2>&1
outB=$("${B[@]}" exec "globalThis.secret" 2>/dev/null)
[ "$outB" != "AAA" ] && ok "T1 B cannot see A's page state (got '$outB')" || bad "T1 B saw A's secret"
ctrB=$(ctr_of web2-e2e-B)
[ -n "$ctrB" ] && [ "$ctrB" != "$(ctr_of web2-e2e-A)" ] && ok "T1 separate containers" || bad "T1 same container"

# B's reset must not touch A (exec JSON-stringifies, hence the quotes)
"${B[@]}" reset >/dev/null 2>&1
outA=$("${A[@]}" exec "globalThis.secret" 2>/dev/null)
[ "$outA" = '"AAA"' ] && ok "T1 B's reset left A intact" || bad "T1 A lost state after B reset (got '$outA')"

# --- T11: status does not start a browser; reset clears state
D=(env "${BASE_ENV[@]}" CLAUDE_CODE_SESSION_ID=web2-e2e-D "$BIN")
outD=$("${D[@]}" status 2>/dev/null)
echo "$outD" | grep -q "no browser running" && ok "T11 status reports none" || bad "T11 status: $outD"
[ -z "$(ctr_of web2-e2e-D)" ] && ok "T11 status did not start a browser" || bad "T11 status started a browser"
"${A[@]}" reset >/dev/null 2>&1
outA=$("${A[@]}" exec "globalThis.secret" 2>/dev/null)
[ "$outA" != '"AAA"' ] && ok "T11 reset cleared own state" || bad "T11 reset kept state"
statOut=$("${A[@]}" status 2>&1)
echo "$statOut" | grep -q "uptime:" && ok "T11 status shows uptime" || bad "T11 status missing uptime: $statOut"

# --- T3: idle-kill + revive with restart note. One revive command with the
# streams captured separately - a second command would race the (tiny) idle
# window.
C=(env "${BASE_ENV[@]}" WEB2_IDLE_TIMEOUT=3 CLAUDE_CODE_SESSION_ID=web2-e2e-C "$BIN")
"${C[@]}" exec "1" >/dev/null 2>&1
ctrC=$(ctr_of web2-e2e-C)
[ -n "$ctrC" ] || bad "T3 no container created"
for i in $(seq 1 60); do
  [ -z "$(ctr_of web2-e2e-C)" ] && break
  sleep 0.5
done
[ -z "$(ctr_of web2-e2e-C)" ] && ok "T3 idle watchdog killed the browser" || bad "T3 browser survived idle timeout"
ERR_C=$(mktemp)
outC=$("${C[@]}" exec "7*6" 2> "$ERR_C")
grep -q "browser (re)started" "$ERR_C" && ok "T3 restart note shown" || bad "T3 no restart note: $(cat "$ERR_C")"
[ "$outC" = "42" ] && ok "T3 revived browser works" || bad "T3 revived exec got '$outC'"
rm -f "$ERR_C"

# --- T7: admin agent-gate
gateOut=$(env "${BASE_ENV[@]}" CLAUDECODE=1 WEB2_ADMIN= "$BIN" admin list 2>&1)
gateCode=$?
[ "$gateCode" = "3" ] && ok "T7 admin blocked for agents (exit 3)" || bad "T7 exit=$gateCode"
echo "$gateOut" | grep -q "human-only" && ok "T7 gate message" || bad "T7 message: $gateOut"
env "${BASE_ENV[@]}" CLAUDECODE=1 WEB2_ADMIN=1 "$BIN" admin list >/dev/null 2>&1 \
  && ok "T7 WEB2_ADMIN=1 authorizes" || bad "T7 WEB2_ADMIN=1 blocked"

# --- T10: capacity is decided by free memory in the Docker VM, not by a count
# of web2's own containers - the VM's memory is shared with every other
# container on the machine. An impossible threshold stands in for a full VM.
capOut=$(env "${BASE_ENV[@]}" WEB2_MIN_FREE_MB=99999999 CLAUDE_CODE_SESSION_ID=web2-e2e-E "$BIN" exec "1" 2>&1)
capCode=$?
[ "$capCode" = "3" ] && ok "T10 capacity refused (exit 3)" || bad "T10 exit=$capCode: $capOut"
echo "$capOut" | grep -q "not enough memory" && ok "T10 capacity message" || bad "T10 message: $capOut"
[ -z "$(ctr_of web2-e2e-E)" ] && ok "T10 refused browser was not created" || bad "T10 E was created anyway"
[ -n "$(ctr_of web2-e2e-A)" ] && ok "T10 existing browser not evicted" || bad "T10 A was evicted"

# --- T6: lock - parallel command gets busy error (exit 5) once the wait runs
# out. The wait is shortened here on purpose: proving the busy path is about
# the exit code and the message, not about sitting through the production
# 30s timeout, which used to be a third of this whole suite.
HOLDER_LOG=$(mktemp)
"${A[@]}" exec "new Promise(r => setTimeout(r, 50000)).then(() => 'holder-done')" > "$HOLDER_LOG" 2>&1 &
HOLDER=$!
sleep 3
busyOut=$(env "${BASE_ENV[@]}" WEB2_LOCK_WAIT=3 CLAUDE_CODE_SESSION_ID=web2-e2e-A "$BIN" exec "1" 2>&1)
busyCode=$?
{ kill "$HOLDER"; wait "$HOLDER"; } 2>/dev/null
[ "$busyCode" = "5" ] && ok "T6 busy exit code 5" || bad "T6 exit=$busyCode out=$busyOut holder=$(cat "$HOLDER_LOG")"
echo "$busyOut" | grep -q "browser busy" && ok "T6 busy message" || bad "T6 message: $busyOut"
rm -f "$HOLDER_LOG"

# --- T12: a finished command must leave the lock free. The heartbeat
# refresher inherited flock's descriptor and kept the lock for its whole
# sleep interval, so every follow-up command from the same owner queued
# behind a command that had already exited: ~15s of dead wait on each.
# Measured end to end on purpose. Asserting that one named lock file is
# unlocked proved worthless: a broken fix locked a DIFFERENT file (flock's
# fd form takes no command, so `flock ... 9 cmd` locks a file called "9")
# and the file-specific check passed while every command still queued.
# Start from a fresh browser: T6 leaves its 50s holder running INSIDE the
# container (killing the host process does not stop the in-container command),
# and that holder would be measured here as a queue it is not responsible for.
"${A[@]}" reset >/dev/null 2>&1
"${A[@]}" exec "1" >/dev/null 2>&1
slow=0
for i in 1 2 3; do
  t0=$(date +%s)
  "${A[@]}" exec "1" >/dev/null 2>&1
  elapsed=$(( $(date +%s) - t0 ))
  [ "$elapsed" -ge 8 ] && slow=$((slow + 1))
  say "T12 follow-up $i took ${elapsed}s"
done
[ "$slow" -eq 0 ] && ok "T12 back-to-back commands are not queued" \
  || bad "T12 $slow of 3 follow-ups waited 8s or more"

# No descendant of a finished command may keep ANY flock: that is what makes
# the next command wait, whichever file the lock happens to live on.
ctrA=$(ctr_of web2-e2e-A)
held=$(docker exec "$ctrA" sh -c 'grep -c FLOCK /proc/locks' 2>/dev/null | tr -d '\r')
[ "${held:-1}" = "0" ] && ok "T12 no flock held after the command exits" \
  || bad "T12 $held flock(s) still held after the command exited"

# --- T13: subagent isolation. Every subagent of one Claude Code session
# inherits the same CLAUDE_CODE_SESSION_ID and the same agent ancestor, so on
# the environment alone they are indistinguishable: they all resolved to one
# browser and overwrote each other's pages. The harness knows who is calling
# and tells the PreToolUse hook, which passes it down as WEB2_AGENT. Proven
# end to end here, starting from a real hook payload on stdin.
TOOL_INPUT='"tool_input":{"command":"web2 exec 1","description":"d"}'
rewritten=$(printf '%s' "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"agent_id\":\"web2e2esubA\",$TOOL_INPUT}" \
  | "$BIN" hook pretooluse 2>/dev/null)
echo "$rewritten" | grep -q 'export WEB2_AGENT=web2e2esubA; web2 exec 1' \
  && ok "T13 hook rewrites a subagent's command" || bad "T13 hook output: $rewritten"

mainOut=$(printf '%s' "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",$TOOL_INPUT}" \
  | "$BIN" hook pretooluse 2>/dev/null)
[ -z "$mainOut" ] && ok "T13 main session is left alone" || bad "T13 main session rewritten: $mainOut"

# Two subagents of ONE session, exactly as the hook would invoke them. Their
# browsers are started in parallel: they are separate owners with separate
# locks, so serializing them would only buy a second container startup.
SUBA=(env "${BASE_ENV[@]}" CLAUDE_CODE_SESSION_ID=web2-e2e-A WEB2_AGENT=web2e2esubA "$BIN")
SUBB=(env "${BASE_ENV[@]}" CLAUDE_CODE_SESSION_ID=web2-e2e-A WEB2_AGENT=web2e2esubB "$BIN")
"${A[@]}"    exec "globalThis.mark = 'parent'" >/dev/null 2>&1
"${SUBA[@]}" exec "globalThis.mark = 'subA'"   >/dev/null 2>&1 &
subAPid=$!
"${SUBB[@]}" exec "globalThis.mark = 'subB'"   >/dev/null 2>&1 &
wait "$subAPid" $! 2>/dev/null

outSubA=$("${SUBA[@]}" exec "globalThis.mark" 2>/dev/null)
[ "$outSubA" = '"subA"' ] && ok "T13 subagent A kept its own page" \
  || bad "T13 subagent A saw '$outSubA', want \"subA\""
outParent=$("${A[@]}" exec "globalThis.mark" 2>/dev/null)
[ "$outParent" = '"parent"' ] && ok "T13 subagents did not touch the parent's page" \
  || bad "T13 parent saw '$outParent', want \"parent\""

ctrParent=$(ctr_of web2-e2e-A)
ctrSubA=$(ctr_of_key "agent:web2e2esubA")
ctrSubB=$(ctr_of_key "agent:web2e2esubB")
distinct=$(printf '%s\n%s\n%s\n' "$ctrParent" "$ctrSubA" "$ctrSubB" | sort -u | grep -c .)
[ "$distinct" = "3" ] && ok "T13 parent and both subagents got their own browser" \
  || bad "T13 expected 3 browsers, got $distinct (parent=$ctrParent A=$ctrSubA B=$ctrSubB)"

# An owner the caller set explicitly still wins over the injected one.
explicitOut=$(printf '%s' "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"agent_id\":\"web2e2esubA\",\"tool_input\":{\"command\":\"WEB2_SESSION=ci web2 status\"}}" \
  | "$BIN" hook pretooluse 2>/dev/null)
[ -z "$explicitOut" ] && ok "T13 explicit WEB2_SESSION is not overridden" \
  || bad "T13 explicit owner was rewritten: $explicitOut"

echo ""
echo "docker tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
