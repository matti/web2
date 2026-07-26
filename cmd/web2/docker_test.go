package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestImageExists pins the one thing that is easy to get wrong about
// `docker image inspect`: on a MISSING image it prints "[]" to stdout and
// exits non-zero. Judging existence by "stdout is non-empty" therefore
// reports every image as present - which made `web2 doctor` claim
// "Image web2:latest: found" on a host with no such image, and stopped
// startContainer from ever building the image on first run.
func TestImageExists(t *testing.T) {
	cases := []struct {
		name string
		out  string
		err  error
		want bool
	}{
		{"missing image: docker prints [] and exits 1", "[]\n", errors.New("exit status 1"), false},
		{"present image", "sha256:8b1a9953c4611296a827abf8c47804d7\n", nil, true},
		{"present image, no trailing newline", "sha256:8b1a99", nil, true},
		{"empty stdout without error is not proof", "", nil, false},
		{"docker binary missing", "", errors.New("exec: \"docker\": not found"), false},
		{"daemon down", "", errors.New("cannot connect to the Docker daemon"), false},
	}

	orig := dockerProbe
	defer func() { dockerProbe = orig }()

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotArgs []string
			dockerProbe = func(args ...string) (string, error) {
				gotArgs = args
				return tc.out, tc.err
			}
			if got := imageExists("web2:latest"); got != tc.want {
				t.Errorf("imageExists() = %v, want %v (stdout %q, err %v)", got, tc.want, tc.out, tc.err)
			}
			if len(gotArgs) == 0 || gotArgs[0] != "image" || gotArgs[1] != "inspect" {
				t.Errorf("probe args = %v, want an `image inspect` call", gotArgs)
			}
			if gotArgs[len(gotArgs)-1] != "web2:latest" {
				t.Errorf("probe args = %v, want the ref last", gotArgs)
			}
		})
	}
}

// The playwright base image ships exactly the browser build that its own
// release pins. When the lockfile resolves a DIFFERENT playwright version,
// the first thing `npx playwright install chromium` does is delete the
// browsers the base image shipped and download ~180 MB of replacements, on
// every single image build. Nothing fails loudly, the build just silently
// pays for a large download it did not need, so a guard is the only way this
// stays noticed.
//
// Matching is on major.minor: playwright pins its browser revisions per minor
// release, and patch releases reuse them, so v1.58.0-noble is a correct base
// for a lockfile on 1.58.2. A minor-level drift (1.52 vs 1.58) is not.
func TestBaseImageMatchesLockedPlaywright(t *testing.T) {
	dockerfile := readRepoFile(t, "docker/Dockerfile")
	base := regexp.MustCompile(`playwright:v(\d+\.\d+)\.\d+-`).FindStringSubmatch(dockerfile)
	if base == nil {
		t.Fatal("no playwright base image tag found in docker/Dockerfile")
	}

	var lock struct {
		Packages map[string]struct {
			Version string `json:"version"`
		} `json:"packages"`
	}
	if err := json.Unmarshal([]byte(readRepoFile(t, "package-lock.json")), &lock); err != nil {
		t.Fatalf("parse package-lock.json: %v", err)
	}
	locked := lock.Packages["node_modules/playwright"].Version
	if locked == "" {
		t.Fatal("playwright not found in package-lock.json")
	}
	lockedMinor := regexp.MustCompile(`^(\d+\.\d+)\.`).FindStringSubmatch(locked)
	if lockedMinor == nil {
		t.Fatalf("unparseable playwright version in lockfile: %q", locked)
	}

	if base[1] != lockedMinor[1] {
		t.Errorf("base image is playwright v%s.x but the lockfile resolves %s; "+
			"every build will discard the image's browsers and re-download them",
			base[1], locked)
	}
}

func readRepoFile(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(b)
}

// Only $HOME is bind-mounted, and the container sees its PHYSICAL contents.
// A logical cwd therefore has to be resolved before it is judged: $HOME/dev
// can be a symlink to /Users/Shared/dev, which passes a plain string prefix
// test but does not exist inside the container. docker exec then dies with
// `chdir to cwd ("/Users/mpa/dev/web") failed: no such file or directory`.
func TestWorkdirUnderHome(t *testing.T) {
	const home = "/Users/mpa"

	// $HOME/dev is a symlink to /Users/Shared/dev; everything else is real.
	resolve := func(p string) (string, error) {
		if p == home+"/dev" || strings.HasPrefix(p, home+"/dev/") {
			return "/Users/Shared/dev" + strings.TrimPrefix(p, home+"/dev"), nil
		}
		if p == home+"/link" {
			return home + "/real", nil
		}
		if p == "/gone" {
			return "", errors.New("no such file or directory")
		}
		return p, nil
	}

	cases := []struct {
		name string
		cwd  string
		want string
	}{
		{"plain dir under home", home + "/projects/x", home + "/projects/x"},
		{"home itself", home, home},
		{"symlink out of home falls back to home", home + "/dev/web", home},
		{"the symlink itself falls back to home", home + "/dev", home},
		{"path outside home falls back to home", "/Users/Shared/dev/web", home},
		{"symlink staying inside home keeps its target", home + "/link", home + "/real"},
		{"unresolvable path falls back to home", "/gone", home},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := workdirUnderHome(tc.cwd, home, resolve); got != tc.want {
				t.Errorf("workdirUnderHome(%q) = %q, want %q", tc.cwd, got, tc.want)
			}
		})
	}
}

// The `[]`-on-stdout trap is invisible at the call site, so every existence
// check must go through imageExists rather than re-deriving the logic.
func TestNoDirectImageInspect(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		name := e.Name()
		if filepath.Ext(name) != ".go" || strings.HasSuffix(name, "_test.go") || name == "docker.go" {
			continue
		}
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), `"image", "inspect"`) {
			t.Errorf("%s calls `docker image inspect` directly; use imageExists() "+
				"- a missing image prints \"[]\" to stdout, so raw stdout is not a presence check", name)
		}
	}
}
