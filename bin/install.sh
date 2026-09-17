#!/usr/bin/env bash
# Installs the web2 skills (and the subagent PreToolUse hook) into the
# active Claude Code profile. Idempotent: run it again to refresh.
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
settings="$cfg/settings.json"

mkdir -p "$cfg/skills"
for dir in "$src"/skills/*/; do
  name="web2-$(basename "$dir")"
  ln -sfn "${dir%/}" "$cfg/skills/$name"
  echo "skill: $cfg/skills/$name"
done

hook='web2 hook pretooluse 2>/dev/null || true'
[ -f "$settings" ] || echo '{}' > "$settings"
if grep -qF 'web2 hook pretooluse' "$settings"; then
  echo "hook: already in $settings"
else
  jq --arg cmd "$hook" '.hooks.PreToolUse += [{
    matcher: "Bash",
    hooks: [{ type: "command", command: $cmd, timeout: 5 }]
  }]' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
  echo "hook: added to $settings"
fi

command -v web2 >/dev/null || echo "warning: web2 binary not on PATH - see README install step 1"
