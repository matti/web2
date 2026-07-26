package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// buildBinary compiles web2 once per test binary and returns its path.
func buildBinary(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not available")
	}
	bin := filepath.Join(t.TempDir(), "web2")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	return bin
}

// runWithoutDocker runs the binary with a PATH that contains no docker, so any
// attempt to reach the daemon fails loudly instead of silently succeeding.
// Returns combined output and the exit code.
func runWithoutDocker(t *testing.T, bin string, args ...string) (string, int) {
	t.Helper()
	cmd := exec.Command(bin, args...)
	cmd.Env = append(os.Environ(), "WEB2_NO_REBUILD=1", "PATH="+t.TempDir())
	out, err := cmd.CombinedOutput()
	code := 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
	} else if err != nil {
		t.Fatalf("run %v: %v", args, err)
	}
	return string(out), code
}

// A typo must not cost a container start. `web2 session list` printed
// "note: browser (re)started" and only then failed with "unknown command",
// because unknown names were forwarded to the container unchecked. Rejecting
// them host-side has to happen before anything touches docker.
func TestUnknownCommandNeverStartsBrowser(t *testing.T) {
	bin := buildBinary(t)

	for _, name := range []string{"session", "nosuchcommand", "ensure", "destroy"} {
		t.Run(name, func(t *testing.T) {
			out, code := runWithoutDocker(t, bin, name, "list")

			if code != exitUsage {
				t.Errorf("exit = %d, want %d (usage); output:\n%s", code, exitUsage, out)
			}
			if !strings.Contains(out, name) {
				t.Errorf("error text does not name the offending command %q:\n%s", name, out)
			}
			lower := strings.ToLower(out)
			for _, forbidden := range []string{"browser (re)started", "docker", "executable file not found"} {
				if strings.Contains(lower, strings.ToLower(forbidden)) {
					t.Errorf("unknown command reached the container layer (%q in output):\n%s", forbidden, out)
				}
			}
		})
	}
}

// The counterpart: a REAL command must still be delegated. With docker absent
// it has to fail as infrastructure, never as a usage error, or the allowlist
// is rejecting valid commands.
func TestKnownCommandIsDelegated(t *testing.T) {
	bin := buildBinary(t)

	for _, name := range []string{"go", "exec", "crawl"} {
		t.Run(name, func(t *testing.T) {
			_, code := runWithoutDocker(t, bin, name, "https://example.com")
			if code == exitUsage {
				t.Errorf("%q was rejected as a usage error; it is a real command", name)
			}
		})
	}
}

// The host allowlist and the in-container CLI must not drift: a command added
// to src/cli.ts but missing here becomes unreachable, and one removed there
// but left here starts a browser only to fail inside.
func TestAllowlistMatchesContainerCLI(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "src", "cli.ts"))
	if err != nil {
		t.Fatalf("read cli.ts: %v", err)
	}

	var declared []string
	for _, m := range regexp.MustCompile(`program\.command\("([a-z-]+)"`).FindAllStringSubmatch(string(src), -1) {
		declared = append(declared, m[1])
	}
	if len(declared) == 0 {
		t.Fatal("no commands parsed from src/cli.ts")
	}
	sort.Strings(declared)
	declared = dedupeStrings(declared)

	var allowed []string
	for _, name := range declared {
		if !isContainerCommand(name) {
			t.Errorf("src/cli.ts registers %q but the host allowlist rejects it", name)
		}
	}
	for _, name := range containerCommands() {
		allowed = append(allowed, name)
		if !contains(declared, name) {
			t.Errorf("host allowlist has %q, which src/cli.ts does not register", name)
		}
	}
	if len(allowed) == 0 {
		t.Error("containerCommands() is empty")
	}
}

func dedupeStrings(in []string) []string {
	var out []string
	for i, s := range in {
		if i == 0 || in[i-1] != s {
			out = append(out, s)
		}
	}
	return out
}

func contains(hay []string, needle string) bool {
	for _, s := range hay {
		if s == needle {
			return true
		}
	}
	return false
}
