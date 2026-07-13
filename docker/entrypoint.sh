#!/bin/bash
set -e

# Graceful shutdown: kill child processes on SIGTERM/SIGINT
cleanup() {
  # Stop ffmpeg gracefully so it finalizes the last segment
  [ -n "$FFMPEG_PID" ] && kill -INT "$FFMPEG_PID" 2>/dev/null && wait "$FFMPEG_PID" 2>/dev/null
  kill $(jobs -p) 2>/dev/null
  wait
  exit 0
}
trap cleanup SIGTERM SIGINT

# Runtime state directory. Lives off /tmp so the host's /tmp can be
# bind-mounted into the container at /tmp without shadowing chrome-data,
# heartbeat, dashcam segments, etc.
STATE_DIR="${WEB_STATE_DIR:-/state}"
mkdir -p "$STATE_DIR"
chmod 1777 "$STATE_DIR"

# Chromium path baked at build time
CHROMIUM=$(cat /app/.chromium-path)

# Start virtual display
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX &
export DISPLAY=:99

# Wait for Xvfb
for i in $(seq 1 30); do
  xdpyinfo -display :99 >/dev/null 2>&1 && break
  sleep 0.02
done

# Start services
# Openbox needs a valid XML config; /dev/null triggers a "Document is empty"
# popup on Ubuntu Noble's openbox build.
mkdir -p /etc/openbox
cat > /etc/openbox/rc.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc"/>
XML
openbox --config-file /etc/openbox/rc.xml &
x11vnc -display :99 -passwd secret -forever -shared -rfbport 5900 -q &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &

# CDP stays container-internal (127.0.0.1:19222) — the host checks readiness
# via `docker exec test -f $STATE_DIR/.web-ready`, so no tunnel is needed.

# Pre-create user data dir for clean Chrome profile
CHROME_DATA="$STATE_DIR/chrome-data"
mkdir -p "$CHROME_DATA/Default"
cat > "$CHROME_DATA/Default/Preferences" << 'EOF'
{"browser":{"check_default_browser":false},"profile":{"exit_type":"Normal","exited_cleanly":true,"password_manager_enabled":false},"credentials_enable_service":false,"credentials_enable_autosign_in":false}
EOF

# Launch Chromium with remote debugging on localhost only
#
# Stealth flags:
#   --disable-blink-features=AutomationControlled  — removes navigator.webdriver,
#                                                    the main signal Playwright
#                                                    leaves that basic bot
#                                                    detection (Alibaba Baxia,
#                                                    Cloudflare Turnstile, etc.)
#                                                    uses to trigger captchas.
"$CHROMIUM" --no-sandbox --disable-gpu --test-type \
  --user-data-dir="$CHROME_DATA" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=19222 \
  --remote-allow-origins=* \
  --disable-blink-features=AutomationControlled \
  --disable-infobars \
  --disable-background-networking \
  --disable-default-apps \
  --no-first-run \
  --disable-translate \
  --disable-sync \
  --disable-save-password-bubble \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --load-extension=/opt/extensions/idcac \
  --window-size=1920,1080 \
  about:blank &
CHROME_PID=$!

# Wait for CDP to be ready
for i in $(seq 1 50); do
  if curl -sf http://127.0.0.1:19222/json/version >/dev/null 2>&1; then
    touch "$STATE_DIR/.web-ready"
    break
  fi
  sleep 0.1
done

# Always-on dashcam: rolling buffer of last 5 minutes for debugging
ffmpeg -f x11grab -video_size 1920x1080 -framerate 3 -i :99 \
  -vf scale=960:540 -c:v libx264 -preset ultrafast -crf 30 \
  -pix_fmt yuv420p -threads 1 -g 3 \
  -hls_time 1 -hls_list_size 300 -hls_flags delete_segments \
  -y "$STATE_DIR/.web-record.m3u8" </dev/null >/dev/null 2>&1 &
FFMPEG_PID=$!
echo "$FFMPEG_PID" > "$STATE_DIR/.web-record.pid"
echo '{"mode":"dashcam","output":"dashcam.mp4"}' > "$STATE_DIR/.web-record.json"

# Watchdog: exit on idle (no commands refreshing the heartbeat) or on hard
# TTL (max container lifetime, so a leaked agent loop can't keep the browser
# alive forever). Both configurable via container env at `docker run` time.
IDLE_TIMEOUT="${WEB_IDLE_TIMEOUT:-300}"
TTL="${WEB_TTL:-14400}"
START_TS=$(date +%s)
touch "$STATE_DIR/.web-heartbeat"
(
  while true; do
    sleep 5
    now=$(date +%s)
    hb=$(stat -c %Y "$STATE_DIR/.web-heartbeat" 2>/dev/null || echo "$now")
    if [ $(( now - hb )) -gt "$IDLE_TIMEOUT" ]; then
      echo "Idle timeout ($(( now - hb ))s > ${IDLE_TIMEOUT}s) — shutting down" >&2
      kill $CHROME_PID 2>/dev/null
      break
    fi
    if [ $(( now - START_TS )) -gt "$TTL" ]; then
      echo "TTL reached ($(( now - START_TS ))s > ${TTL}s) — shutting down" >&2
      kill $CHROME_PID 2>/dev/null
      break
    fi
  done
) &

# Exit when Chromium dies (crash → container stops)
wait $CHROME_PID
cleanup
