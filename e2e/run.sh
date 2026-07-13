#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export REPO_DIR

# Parse flags and group filter
RUN_DOCKER=0
RUN_GROUPS=()
for arg in "$@"; do
  case "$arg" in
    --docker) RUN_DOCKER=1 ;;
    --all) RUN_GROUPS=(e2e crawl interact) ;;
    e2e|crawl|interact) RUN_GROUPS+=("$arg") ;;
  esac
done
# Default: fast group only. crawl/interact are rate-limited and slow —
# run them explicitly (./e2e/run.sh crawl) or with --all.
[ ${#RUN_GROUPS[@]} -eq 0 ] && RUN_GROUPS=(e2e)

echo "==> Checking dependencies..."
if [ ! -d "$REPO_DIR/node_modules/playwright" ]; then
  echo "Installing dependencies..."
  (cd "$REPO_DIR" && npm install && npx playwright install chromium)
fi

# Compile only if source is newer than dist
NEWEST_SRC=$(find "$REPO_DIR/src" -name '*.ts' -newer "$REPO_DIR/dist/src/cli.js" 2>/dev/null | head -1)
if [ ! -f "$REPO_DIR/dist/src/cli.js" ] || [ -n "$NEWEST_SRC" ]; then
  echo "==> Compiling TypeScript..."
  (cd "$REPO_DIR" && npx tsc)
else
  echo "==> dist/ is fresh, skipping compile"
fi

CHROMIUM=$(node -e "console.log(require('playwright').chromium.executablePath())")
CHROME_PIDS=()

launch_chromium() {
  local port="$1"
  "$CHROMIUM" --headless --no-sandbox --disable-gpu \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$port" \
    '--remote-allow-origins=*' \
    --no-first-run \
    --disable-extensions \
    --window-size=1920,1080 \
    about:blank &
  CHROME_PIDS+=($!)
}

wait_chromium() {
  local port="$1"
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "WARN: Chromium on port $port did not become ready" >&2
  return 1
}

export E2E_TMPDIR
E2E_TMPDIR="$(mktemp -d)"

# Start shared mock server
MOCK_URLFILE="$E2E_TMPDIR/shared-mock-url"
npx tsx "$REPO_DIR/src/tests/mock-server.ts" > "$MOCK_URLFILE" 2>/dev/null &
MOCK_PID=$!

for i in $(seq 1 50); do
  if [ -s "$MOCK_URLFILE" ]; then break; fi
  sleep 0.1
done

if [ ! -s "$MOCK_URLFILE" ]; then
  echo "FAIL: shared mock server did not start" >&2
  exit 1
fi

export MOCK_URL
MOCK_URL="$(head -1 "$MOCK_URLFILE")"
echo "    Mock server at $MOCK_URL"

cleanup() {
  kill "$MOCK_PID" 2>/dev/null || true
  wait "$MOCK_PID" 2>/dev/null || true
  for pid in "${CHROME_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$E2E_TMPDIR"
}
trap cleanup EXIT

# Each test script gets its own Chromium on a unique CDP port for max parallelism.

wants_group() { for g in "${RUN_GROUPS[@]}"; do [ "$g" = "$1" ] && return 0; done; return 1; }

run_script() {
  local test_script="$1" port="$2"
  local name ext
  name="$(basename "$test_script")"
  name="${name%.*}"
  ext="${test_script##*.}"
  local logfile="$E2E_TMPDIR/${name}.log"
  # Per-script state dir: /state doesn't exist on the host, and parallel
  # scripts must not share tab-state/network-log files.
  local state_dir="$E2E_TMPDIR/state-${name}"
  mkdir -p "$state_dir"

  {
    echo ""
    echo "==> $name"
    if [ "$ext" = "ts" ]; then
      if CDP_PORT="$port" WEB_STATE_DIR="$state_dir" npx tsx "$test_script"; then
        echo "1 0" > "$E2E_TMPDIR/${name}.result"
      else
        echo "0 1" > "$E2E_TMPDIR/${name}.result"
      fi
    else
      if CDP_PORT="$port" WEB_STATE_DIR="$state_dir" bash "$test_script"; then
        echo "1 0" > "$E2E_TMPDIR/${name}.result"
      else
        echo "0 1" > "$E2E_TMPDIR/${name}.result"
      fi
    fi
  } > "$logfile" 2>&1
}

# Collect test scripts (.ts preferred, .sh fallback for docker/reconnect)
all_scripts=()

for test_script in "$REPO_DIR"/e2e/test-*.ts "$REPO_DIR"/e2e/test-*.sh; do
  [ -f "$test_script" ] || continue
  name="$(basename "$test_script")"
  base="${name%.*}"

  # Skip .sh if a .ts version exists
  if [[ "$name" == *.sh ]] && [ -f "$REPO_DIR/e2e/${base}.ts" ]; then
    continue
  fi

  # Skip Docker/rebuild tests unless --docker flag
  if [[ "$name" == *docker* ]] || [[ "$name" == *reconnect* ]]; then
    continue
  fi

  # Skip soak test (slow, 54 sequential navigations)
  if [[ "$base" == "test-soak" ]]; then
    continue
  fi

  # Filter by group
  if [[ "$base" == *crawl* ]]; then
    wants_group crawl || continue
  elif [[ "$base" == *interact* ]]; then
    wants_group interact || continue
  else
    wants_group e2e || continue
  fi

  all_scripts+=("$test_script")
done

# Launch all Chromium instances in parallel, then wait for all to be ready
echo "==> Starting ${#all_scripts[@]} Chromium instances..."
SCRIPT_PIDS=()
SCRIPT_NAMES=()
PORTS=()
port=9222

for test_script in "${all_scripts[@]}"; do
  launch_chromium "$port"
  name="$(basename "$test_script")"
  PORTS+=("$port")
  SCRIPT_NAMES+=("${name%.*}")
  port=$((port + 1))
done

for p in "${PORTS[@]}"; do
  wait_chromium "$p"
done

# Start all test scripts in parallel
for i in "${!all_scripts[@]}"; do
  run_script "${all_scripts[$i]}" "${PORTS[$i]}" &
  SCRIPT_PIDS+=($!)
done

# Wait for all
for pid in "${SCRIPT_PIDS[@]}"; do
  wait "$pid" || true
done

# Print logs and collect results
total_passed=0
total_failed=0

for name in "${SCRIPT_NAMES[@]}"; do
  cat "$E2E_TMPDIR/${name}.log"
  if [ -f "$E2E_TMPDIR/${name}.result" ]; then
    read -r p f < "$E2E_TMPDIR/${name}.result"
    total_passed=$((total_passed + p))
    total_failed=$((total_failed + f))
  fi
done

# Docker tests (sequential, separate — cover isolation, memorylessness,
# lifecycle, locking, admin gate against real containers)
if [ "$RUN_DOCKER" -eq 1 ] && [ -f "$REPO_DIR/e2e/test-web2-docker.sh" ]; then
  echo ""
  echo "==> [docker] test-web2-docker.sh"
  if bash "$REPO_DIR/e2e/test-web2-docker.sh"; then
    total_passed=$((total_passed + 1))
  else
    total_failed=$((total_failed + 1))
  fi
else
  echo ""
  echo "==> [docker] test-web2-docker.sh (skipped, use --docker)"
fi

ELAPSED=$(( SECONDS ))
echo ""
echo "=== Results: $total_passed passed, $total_failed failed (${ELAPSED}s) ==="

# Budget applies to the default fast group; crawl/interact/docker runs are
# opt-in and rate-limited by nature.
if [ ${#RUN_GROUPS[@]} -eq 1 ] && [ "${RUN_GROUPS[0]}" = "e2e" ] && [ "$RUN_DOCKER" -eq 0 ] && [ "$ELAPSED" -gt 15 ]; then
  echo "SLOW: e2e took ${ELAPSED}s (budget: 15s). Optimize or parallelize."
  exit 1
fi

[ "$total_failed" -eq 0 ]
