# CLAUDE.md

## Purpose

web2 is an **agent-first** CLI browser automation tool. Everything runs inside
Docker — the user needs nothing on the host except Docker and the `web2`
binary. The core design promise: **every caller lives in a world with exactly
one browser — its own.** There is no session concept on the agent surface;
identity is derived automatically from the environment, the container starts
lazily on the first command, and dies by itself on idle/TTL. Nothing an agent
can run touches another owner's browser. Full design rationale and spec:
`web2.md`.

## Architecture

```
Host (Go binary `web2`)              Docker Container (per owner)
------------------------------       ------------------------------
cmd/web2/                            Node.js + Playwright (compiled JS)
  identity.go   ResolveOwner:          Xvfb + Chromium + IDCAC extension
                env → ancestor →       x11vnc + noVNC (always on)
                term → tty → uid       dashcam (rolling 5min ffmpeg buffer)
  lifecycle.go  lazy ensure, ports,    /usr/local/bin/web2 wrapper:
                cap, readiness           heartbeat + flock serialization
  exec.go       timeout, lock-exempt  entrypoint.sh watchdog:
  reaper.go     label-scoped GC         idle timeout + hard TTL
  admin.go      human-only surface
  <browser cmd> ──docker exec──>     src/cli.ts + all commands
```

Owner identity chain (first match wins): `WEB2_SESSION` → agent session env
(`CLAUDE_CODE_SESSION_ID`) → nearest agent ancestor process (pid+starttime) →
terminal session id → tty → uid. Container name = `web2-<sha256(key)[:12]>`.

Coexistence with v1 (`web`): different binary name, `WEB2_*` host env prefix,
`web2:latest` image, `web2-` container prefix, `web2=true` label, port range
31000–38999. The host binary never reads bare `WEB_*` vars (enforced by test).
Inside the container v1's `WEB_*` names are kept so `src/` stays portable.

### Key rules

- **No session surface.** No list/ensure/destroy on the agent surface; errors
  never mention other browsers. `web2 admin` is the only cross-owner surface
  and refuses to run when `CLAUDECODE`/`AI_AGENT` is set unless `WEB2_ADMIN=1`.
- **Nothing may depend on caller memory.** Every Bash call from an agent runs
  in a fresh shell with a fresh PID — identity must come from stable signals.
- **Exit codes:** 0 ok · 1 command failed · 2 usage · 3 infra · 4 timeout ·
  5 busy (lock). No others.
- **Output contract:** data → stdout, meta → stderr. Page-mutating commands
  end with a grounding line on stderr: `→ <url> — "<title>"`.
- **Reaper rules:** exited containers always removed; running `proc`-kind
  owners removed only on pid+starttime mismatch; uuid-kind owners are NEVER
  reaped from the host (idle/TTL handles them).

## Running

```bash
web2 go https://example.com     # first command starts the browser
web2 extract accessibility
web2 page screenshot --output shot.png
web2 status                     # never starts a browser
web2 reset                      # fresh browser (own world only)
web2 open novnc                 # watch your own browser
web2 admin list                 # humans only
```

Dev mode: running inside this repo mounts `src/` into the container (tsx, no
image rebuild needed) and auto-rebuilds the Go binary when sources change
(`WEB2_NO_REBUILD=1` disables).

## Testing — TDD required (NON-NEGOTIABLE)

**Every change must include a test, written BEFORE the implementation
(red-green-refactor).** Bug fix → failing repro test first.

```bash
npm test                # TS unit tests (< 3s)
(cd cmd/web2 && go test ./...)   # Go unit tests incl. regression guards
./e2e/run.sh            # fast host e2e group (budget 15s)
./e2e/run.sh crawl interact      # slow rate-limited groups (opt-in)
./e2e/run.sh --docker   # docker suite: isolation T1, memorylessness T2,
                        # idle/TTL T3, lock T6, admin gate T7, cap T10,
                        # status/reset T11 (budget ~120s)
```

### Performance budgets (enforced)

- Code timeouts: max 2000ms in tests. Bash tool: max 30s. `npm test` < 3s.
- Fast e2e group < 15s. E2e uses compiled JS (`node dist/`), not tsx.
- New e2e scripts must be independent (own Chromium, parallel).

### Regression guards (cmd/web2/main_test.go — keep passing)

- `web2 --help` and usage() must never contain the word "session".
- Banned strings in host source: `web-default`, `web2-default`,
  `Multiple sessions`.
- Host binary must not read any bare `WEB_*` env var.

## Gotchas (learned the hard way — do not reintroduce)

- `docker ps --format` needs `{{.Label "x"}}`; `{{index .Labels "x"}}` only
  works in `docker inspect` (ps .Labels is a string).
- `/dev/null` IS a char device: a naive isTerminal() passes `-t` to docker
  exec and dies with "the input device is not a TTY" when output is
  redirected. See isTerminal in docker.go.
- With extensions loaded, `browser.contexts()` ordering is nondeterministic —
  never assume `contexts[0]` owns the pages (see withPage / tab.ts).
- Never `page.close()` a page withPage created — first-command state would
  vanish (the initial about:blank target may attach late after startup).
- The exec command JSON-stringifies results: `exec "'a'"` prints `"a"`.
- CDP cookie limitation: `context.cookies()` is empty over connectOverCDP;
  cookies go through `Network.getAllCookies` (see cookies.ts).

## Debugging

```bash
WEB2_DEBUG=1 web2 go https://example.com   # timestamps host + container
web2 record save --output debug.mp4       # dashcam: last 5 minutes of video
web2 open novnc                            # live view
docker logs <web2-...>                     # entrypoint/watchdog logs
```
