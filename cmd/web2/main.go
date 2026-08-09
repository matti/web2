package main

import (
	"fmt"
	"os"
	"time"
)

// web2 - agent-first CLI browser automation.
//
// Design (see web2.md): every caller lives in a world with exactly one
// browser - its own. There is no session concept on this surface: identity
// is derived from the environment (identity.go), the container starts
// lazily, dies on idle/TTL, and nothing an agent can run touches another
// owner's browser.

var (
	image  = envOr("WEB2_IMAGE", "web2:latest")
	prefix = "web2-"
	debug  = os.Getenv("WEB2_DEBUG") != ""
)

// Exit codes (web2.md 4.8): 0 ok · 1 command failed · 2 usage · 3 infra ·
// 4 timeout · 5 busy. No others.
const (
	exitCommand = 1
	exitUsage   = 2
	exitInfra   = 3
	exitTimeout = 4
	exitBusy    = 5
)

func main() {
	args := os.Args[1:]

	// The PreToolUse hook runs on every Bash tool call in the harness, so it
	// dispatches before rebuild and reaper work ever starts.
	if len(args) > 0 && args[0] == "hook" {
		cmdHook(args[1:])
		return
	}

	maybeRebuild()

	if len(args) == 0 {
		usage()
		os.Exit(0)
	}

	cmd, rest := args[0], args[1:]
	if !isHostCommand(cmd) && !isContainerCommand(cmd) {
		fmt.Fprintf(os.Stderr, "Error: unknown command %q. Run 'web2 --help' for usage.\n", cmd)
		os.Exit(exitUsage)
	}

	// Lazy cleanup of provably-orphaned containers (best-effort, label-scoped).
	reapOrphans()

	switch cmd {
	case "status":
		cmdStatus(rest)
	case "reset":
		cmdReset(rest)
	case "open":
		cmdOpen(rest)
	case "doctor":
		cmdDoctor(rest)
	case "admin":
		cmdAdmin(rest)
	case "help", "-h", "--help":
		usage()
	default:
		// All browser commands delegate to the container.
		cmdExec(cmd, rest)
	}
}

func isHostCommand(name string) bool {
	switch name {
	// "hook" is deliberately absent from usage(): it is the harness talking
	// to web2, never an agent or a human. main() dispatches it before this.
	case "status", "reset", "open", "doctor", "admin", "hook", "help", "-h", "--help":
		return true
	default:
		return false
	}
}

func containerCommands() []string {
	return []string{
		"cookies",
		"crawl",
		"do",
		"exec",
		"extract",
		"go",
		"network",
		"normalize",
		"page",
		"pdf",
		"record",
		"reload",
		"status",
		"tab",
		"viewport",
		"wait",
	}
}

func isContainerCommand(name string) bool {
	for _, command := range containerCommands() {
		if name == command {
			return true
		}
	}
	return false
}

func usage() {
	fmt.Print(`Usage: web2 <command> [options]

Your browser starts automatically on the first command and cleans itself up
when idle. There is nothing to set up or tear down.

Browse:
  go <url> [--wait strategy]      Navigate to a URL
  reload [--wait strategy]        Reload the current page
  exec <js>                       Execute JavaScript
  wait <cond> [--timeout]         Wait for a selector, text:, url:, hidden:,
                                  or network-idle
  crawl [--depth N] [--limit N]   Crawl site from current page
  normalize <dir>                 Crawled DOM to sorted TSV for proofreading
  pdf [--output f] [--format f]   Generate PDF of current page
  network [--json]                Requests captured during last navigation

Page:
  page screenshot [--output] [--full-page] [--selector]  Take a screenshot
  page view [--full-page] [--width]         View page in terminal
  page tail [--interval ms]                 Live-refreshing page view

Viewport:
  viewport resize <w> <h>         Set viewport dimensions
  viewport size                   Print current viewport dimensions
  viewport preset <name>          Apply preset: mobile, tablet, desktop, 1080p
  viewport rotate                 Swap width/height (portrait/landscape)

Tab:
  tab list                        List open tabs
  tab create [url]                Open a new tab
  tab select <index>              Switch to tab by index
  tab next / tab previous         Cycle tabs
  tab close [index]               Close a tab (active if omitted)

Extract:
  extract accessibility [--fmt]   Accessibility snapshot
  extract selector <sel> [opts]   Extract text/attributes from elements
  extract table [sel] [--json]    Extract table data
  extract reader [url] [--output] Reader mode: extract clean text
  extract links                   List all link destinations
  extract source                  Print hydrated HTML
  extract text                    Dump page text

Do:
  do click <sel> [--text T] [--double] [--right]   Click an element
  do fill <sel> [value] [--clear]  Fill or clear a form field
  do upload <sel> <file...>       Attach file(s) to an <input type=file>
  do type <text> [--selector S]   Type text into focused element
  do press <key>                  Press a key (Enter, Tab, Escape, ...)
  do select <sel> <values...>     Select dropdown option(s)
  do hover <sel>                  Hover over an element
  do scroll <direction>           Scroll: down, up, bottom, top, or pixels
  do dismiss                      Dismiss cookie consent banners

Cookies:
  cookies list [--json]           List cookies
  cookies clear                   Clear all cookies

Record (dashcam always on - rolling 5min buffer):
  record save [--output FILE]     Save current dashcam buffer to file
  record stop                     Stop recording and save the video
  record start [--output FILE]    Start a full recording (replaces dashcam)
  record dashcam [--seconds N]    Restart dashcam with custom buffer size

Browser:
  status                          Show this browser: url, title, tabs, uptime
  reset                           Replace this browser with a fresh one
  open vnc / open novnc           Watch this browser live

Utilities:
  doctor                          Check Docker, image, and browser capacity
  admin                           (human only)
`)
}

func die(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "Error: "+format+"\n", args...)
	os.Exit(exitCommand)
}

func dbg(format string, args ...interface{}) {
	if debug {
		fmt.Fprintf(os.Stderr, "[%s] "+format+"\n", append([]interface{}{time.Now().Format("15:04:05.000")}, args...)...)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
