package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestContainerPorts(t *testing.T) {
	v1, n1 := containerPorts("web2-aaaaaaaaaaaa")
	v2, n2 := containerPorts("web2-aaaaaaaaaaaa")
	if v1 != v2 || n1 != n2 {
		t.Errorf("ports not deterministic")
	}
	if n1 != v1+1 {
		t.Errorf("novnc should be vnc+1, got %d/%d", v1, n1)
	}
	// web2 range must be disjoint from v1's 20000–29999
	for _, name := range []string{"web2-000000000000", "web2-ffffffffffff", "web2-123abc456def"} {
		v, n := containerPorts(name)
		if v < 31000 || n > 38999 {
			t.Errorf("port out of web2 range for %s: %d/%d", name, v, n)
		}
	}
}

func TestLockExemptAndTimeouts(t *testing.T) {
	if !isLockExempt("record", []string{"save"}) {
		t.Error("record should be lock-exempt")
	}
	if !isLockExempt("page", []string{"tail"}) {
		t.Error("page tail should be lock-exempt")
	}
	if isLockExempt("crawl", nil) {
		t.Error("crawl must hold the lock")
	}
	if isLockExempt("page", []string{"screenshot"}) {
		t.Error("page screenshot must hold the lock")
	}

	_, cancel, timeout := commandContext("go", nil)
	cancel()
	if timeout.Seconds() != 60 {
		t.Errorf("default timeout = %v, want 60s", timeout)
	}
	_, cancel, timeout = commandContext("crawl", nil)
	cancel()
	if timeout.Seconds() != 600 {
		t.Errorf("crawl timeout = %v, want 600s", timeout)
	}
	_, cancel, timeout = commandContext("record", []string{"save"})
	cancel()
	if timeout != 0 {
		t.Errorf("record timeout = %v, want none", timeout)
	}
}

func TestCommandBasename(t *testing.T) {
	cases := map[string]string{
		"/bin/zsh -c foo":                      "zsh",
		"-zsh":                                 "zsh",
		"claude --dangerously-skip-permissions": "claude",
		"/usr/local/bin/claude":                "claude",
		"":                                     "",
	}
	for in, want := range cases {
		if got := commandBasename(in); got != want {
			t.Errorf("commandBasename(%q) = %q, want %q", in, got, want)
		}
	}
}

// Regression guards (web2.md 8.3): the agent surface must never mention
// sessions or leak v1 fallback behavior, and the host binary must not read
// bare WEB_* env vars (coexistence with v1).
func TestRegressionGuards(t *testing.T) {
	// usage() must not contain the word "session"
	// (checked against the source to avoid capturing stdout)
	src := readAllGoSource(t)

	if strings.Contains(strings.ToLower(usageText(t)), "session") {
		t.Error("usage() mentions 'session'")
	}
	for _, banned := range []string{"web-default", "web2-default", "Multiple sessions"} {
		if strings.Contains(src, banned) {
			t.Errorf("source contains banned string %q", banned)
		}
	}

	// No os.Getenv("WEB_...") without the WEB2_ prefix in host code.
	for _, line := range strings.Split(src, "\n") {
		if strings.Contains(line, `os.Getenv("WEB_`) {
			t.Errorf("host binary reads a v1 WEB_* env var: %s", strings.TrimSpace(line))
		}
	}
}

// A command that exists but is not in usage() is a command agents never
// find: usage() is the only surface they read. Keep them in sync.
func TestUsageDocumentsEveryContainerCommand(t *testing.T) {
	usage := usageText(t)
	for _, cmd := range containerCommands() {
		// Anchored to a listing line, so "network" is not satisfied by the
		// word "network-idle" appearing in some other command's options.
		listed := regexp.MustCompile(`(?m)^\s+` + regexp.QuoteMeta(cmd) + `\b`)
		if !listed.MatchString(usage) {
			t.Errorf("usage() does not list container command %q", cmd)
		}
	}
}

// Options that exist only in src/cli.ts are invisible to agents too. These
// are the ones e2e covers but usage() used to omit.
func TestUsageDocumentsTestedOptions(t *testing.T) {
	usage := usageText(t)
	for _, opt := range []string{"--double", "--right", "--clear", "hidden:"} {
		if !strings.Contains(usage, opt) {
			t.Errorf("usage() does not mention %q", opt)
		}
	}
}

func usageText(t *testing.T) string {
	t.Helper()
	// usage() prints to stdout; capture via pipe.
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	usage()
	w.Close()
	os.Stdout = old
	buf := make([]byte, 64*1024)
	n, _ := r.Read(buf)
	return string(buf[:n])
}

func readAllGoSource(t *testing.T) string {
	t.Helper()
	var sb strings.Builder
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".go" || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		b, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		sb.Write(b)
		sb.WriteString("\n")
	}
	return sb.String()
}

// The binary must build and `web2 --help` must exit 0 without docker.
func TestHelpExitsZero(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not available")
	}
	bin := filepath.Join(t.TempDir(), "web2")
	build := exec.Command("go", "build", "-o", bin, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	cmd := exec.Command(bin, "--help")
	cmd.Env = append(os.Environ(), "WEB2_NO_REBUILD=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("--help: %v\n%s", err, out)
	}
	if strings.Contains(strings.ToLower(string(out)), "session") {
		t.Error("--help output mentions 'session'")
	}
}
