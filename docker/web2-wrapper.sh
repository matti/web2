#!/bin/sh
# In-container entrypoint for every `web2` command (invoked via docker exec).
#
# 1. Heartbeat: the idle watchdog in entrypoint.sh kills the container when
#    this file goes stale. A background refresher keeps it fresh for the
#    whole duration of the command, so a long crawl can't be idle-killed
#    mid-flight. The refresher watches $$ — exec below replaces the process
#    image but keeps the PID, so the loop ends exactly when the CLI exits.
# 2. Locking: commands from the same owner (e.g. a parent agent and its
#    subagents) are serialized with flock so shared tab state never races.
#    WEB_NO_LOCK=1 (set by the host binary for record/page-tail) skips the
#    lock; WEB2_LOCKED guards against re-locking after the flock re-exec.
#    On lock timeout flock exits 5, which the host maps to "browser busy".
STATE_DIR="${WEB_STATE_DIR:-/state}"
touch "$STATE_DIR/.web-heartbeat"

if [ "$WEB_NO_LOCK" != "1" ] && [ -z "$WEB2_LOCKED" ]; then
  WEB2_LOCKED=1 exec flock -w 30 -E 5 "$STATE_DIR/.web-lock" /usr/local/bin/web2 "$@"
fi

SELF=$$
(
  while kill -0 "$SELF" 2>/dev/null; do
    touch "$STATE_DIR/.web-heartbeat"
    sleep 15
  done
) &

if [ -f /app/src/cli.ts ]; then
  exec /app/node_modules/.bin/tsx /app/src/cli.ts "$@"
else
  exec node /app/dist/src/cli.js "$@"
fi
