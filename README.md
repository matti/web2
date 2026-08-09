# web2

Agent-first CLI browser automation. Everything runs inside Docker - the host
needs only Docker and the `web2` binary.

**The core promise: every caller gets exactly one browser - its own.** There
is nothing to set up, nothing to remember, and nothing you can break for
anyone else:

- The browser **starts automatically** on your first command and **cleans
  itself up** when idle (5 min) or at max age (4 h).
- Identity is **derived from the environment** (agent session id, ancestor
  process, terminal), so parallel agents on one machine get fully isolated
  browsers without carrying any state between commands.
- **Subagents count as callers too.** They are indistinguishable from their
  parent in the environment, so the plugin ships a hook that hands each one
  its own browser - a fan-out of subagents no longer fights over one page.
- No command on the agent surface can see or touch another owner's browser.
  Cross-owner operations live under `web2 admin`, which refuses to run inside
  an agent unless the user sets `WEB2_ADMIN=1`.

```bash
web2 go https://example.com
web2 extract accessibility          # page structure as semdown
web2 do click "#login" 
web2 do fill "input[name=q]" "hello"
web2 page screenshot --output shot.png
web2 extract reader                 # clean article text
web2 crawl --depth 2 --merge --output docs.md
web2 status                         # where am I?
web2 reset                          # brand-new browser
web2 open novnc                     # watch it live
```

Every page-changing command ends with a grounding line on stderr
(`→ <url> - "Title"`), errors are one line and actionable, and every command
supports machine-readable output where it matters.

## Install

**1. Build the binary and put it on your PATH:**

```bash
cd cmd/web2 && go build -o web2 .
ln -s "$(pwd)/web2" /usr/local/bin/web2   # or any directory on your PATH
web2 doctor                               # checks Docker; image builds on first use
```

**2. Install the Claude Code plugin** - run these inside any Claude Code
session:

```
/plugin marketplace add /path/to/web2
/plugin install web2@web2-marketplace
```

That's it. The skills are now available in every session as `/web2:go`,
`/web2:read`, `/web2:crawl` and `/web2:screenshot`, and agents can use the
`web2` CLI directly. Updates flow straight from the directory - no
reinstall needed.

The plugin also installs a `PreToolUse` hook (`hooks/hooks.json`) that gives
every **subagent** its own browser instead of letting them all share the
parent's. Nothing to configure: it only touches Bash commands that run `web2`,
and it leaves the main session alone.

Alternative without the plugin system: copy `skills/*` into
`~/.claude/skills/` (skills appear without the `web2:` prefix) and, if you use
subagents, copy the `hooks` block from `hooks/hooks.json` into your
`settings.json` - otherwise subagents fall back to sharing one browser.

## Inside the box

One Docker container per owner: Playwright-managed Chromium (with stealth
patches and the "I still don't care about cookies" extension), Xvfb, always-on
VNC/noVNC, and a rolling 5-minute dashcam recording for post-mortems. The
host binary is a thin Go orchestrator: it resolves the caller's identity,
lazily ensures the container, serializes concurrent commands with a lock, and
enforces timeouts, resource limits and a host-wide browser cap.

Design document: [web2.md](./web2.md). Contributor guide: [CLAUDE.md](./CLAUDE.md).

## Environment

`WEB2_DEBUG`, `WEB2_NO_REBUILD`, `WEB2_SESSION`, and other `WEB2_*` variables are honored as documented in [CLAUDE.md](./CLAUDE.md).

Additional host lock tuning:

`WEB2_LOCK_WAIT` (seconds). Set this to change how long concurrent
`web2` commands wait for the in-container lock before returning the busy exit
code. The value is forwarded as `WEB_LOCK_WAIT` inside the container and must be
a non-negative integer.

## v1 coexistence

web2 shares nothing with v1 (`web`): different binary, env prefix (`WEB2_*`),
image, container labels and port range. Both can run on the same host without
seeing each other.
