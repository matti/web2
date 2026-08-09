package main

import (
	"fmt"
	"hash/fnv"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// ensureContainer makes sure the owner's browser is running and returns its
// container name. This is the whole lifecycle surface an agent ever touches:
// there is no ensure/run/destroy command — every browser command passes
// through here and gets a live container or dies with an actionable error.
func ensureContainer(o Owner) string {
	ctr := o.ContainerName()
	if containerRunning(ctr) {
		return ctr
	}

	// Remove a stopped leftover with the same name (idle/TTL killed).
	dockerOutputSilent("rm", "-f", ctr)

	checkCapacity()
	startContainer(o, ctr)
	fmt.Fprintln(os.Stderr, "note: browser (re)started - page state was reset")
	return ctr
}

func startContainer(o Owner, ctr string) {
	// Build image if needed
	if !imageExists(image) {
		dbg("start: image not found, building")
		fmt.Fprintln(os.Stderr, "Building web2 Docker image (first run)...")
		if err := buildImage(); err != nil {
			fmt.Fprintf(os.Stderr, "Error: docker build failed: %v\n", err)
			os.Exit(exitInfra)
		}
	}

	home, _ := os.UserHomeDir()
	vncPort, novncPort := containerPorts(ctr)

	runArgs := []string{
		"run", "-d",
		"--name", ctr,
		"--label", "web2=true",
		"--label", "web2.owner.key=" + o.Key,
		"--label", "web2.owner.kind=" + string(o.Kind),
		"-v", home + ":" + home,
		"-p", fmt.Sprintf("127.0.0.1:%d:5900", vncPort),
		"-p", fmt.Sprintf("127.0.0.1:%d:6080", novncPort),
		"--shm-size", "2g",
		"--memory", "2g",
		"--cpus", "2",
		"-e", fmt.Sprintf("WEB_IDLE_TIMEOUT=%d", envInt("WEB2_IDLE_TIMEOUT", 300)),
		"-e", fmt.Sprintf("WEB_TTL=%d", envInt("WEB2_TTL", 14400)),
	}
	// Liveness hint for the reaper (proc kind is reaped on pid+starttime
	// mismatch; other kinds rely on idle/TTL).
	if o.PID != 0 {
		runArgs = append(runArgs,
			"--label", "web2.owner.pid="+strconv.Itoa(o.PID),
			"--label", "web2.owner.starttime="+o.StartTime,
		)
	}

	// Dev mode: mount local src/ and entrypoint so code changes don't need
	// an image rebuild.
	devMode := false
	if root, err := findProjectRoot(); err == nil {
		if src := root + "/src"; fileExists(src) {
			runArgs = append(runArgs, "-v", src+":/app/src")
			devMode = true
			dbg("start: dev mode — mounting %s", src)
		}
		if ep := root + "/docker/entrypoint.sh"; fileExists(ep) {
			runArgs = append(runArgs, "-v", ep+":/entrypoint.sh:ro")
		}
	}

	runArgs = append(runArgs, image)

	if _, err := dockerOutputSilent(runArgs...); err != nil {
		// docker run exit 125 usually means stale/broken image — rebuild and retry
		dbg("start: docker run failed (%v), rebuilding image and retrying", err)
		fmt.Fprintln(os.Stderr, "Rebuilding web2 Docker image...")
		if buildErr := buildImage(); buildErr != nil {
			fmt.Fprintf(os.Stderr, "Error: docker build failed: %v (original run error: %v)\n", buildErr, err)
			os.Exit(exitInfra)
		}
		dockerOutputSilent("rm", "-f", ctr)
		if _, err := dockerOutputSilent(runArgs...); err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to start browser after rebuild: %v\n", err)
			os.Exit(exitInfra)
		}
	}
	dbg("start: container created")

	// Readiness: CDP is container-internal, so poll the ready file via exec.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if err := exec.Command("docker", "exec", ctr, "test", "-f", "/state/.web-ready").Run(); err == nil {
			dbg("start: browser ready")
			if devMode {
				dbg("start: dev mode active")
			}
			return
		}
		time.Sleep(150 * time.Millisecond)
	}

	fmt.Fprintln(os.Stderr, "Error: browser failed to start (30s); run 'web2 doctor'")
	logs, _ := dockerOutputSilent("logs", "--tail", "15", ctr)
	if strings.TrimSpace(logs) != "" {
		fmt.Fprintln(os.Stderr, logs)
	}
	os.Exit(exitInfra)
}

// containerPorts returns deterministic host ports (vnc, novnc) for a
// container name. web2 uses 31000–38999 — disjoint from v1's 20000–29999
// so both tools coexist on one host without collisions.
func containerPorts(name string) (vnc, novnc int) {
	h := fnv.New32a()
	h.Write([]byte(name))
	base := 31000 + int(h.Sum32()%4000)*2
	return base, base + 1
}

// --- project root / image build ---

// isWeb2ProjectRoot checks for markers unique to this project so a foreign
// repo's docker/ directory is never picked up in dev mode.
func isWeb2ProjectRoot(dir string) bool {
	return fileExists(dir+"/docker/Dockerfile") &&
		fileExists(dir+"/cmd/web2/main.go") &&
		fileExists(dir+"/src/cli.ts")
}

func findProjectRoot() (string, error) {
	if root := os.Getenv("WEB2_PROJECT_ROOT"); root != "" {
		return root, nil
	}
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for i := 0; i < 8; i++ {
			if isWeb2ProjectRoot(dir) {
				return dir, nil
			}
			parent := parentDir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	ex, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := ex
	for i := 0; i < 8; i++ {
		dir = parentDir(dir)
		if isWeb2ProjectRoot(dir) {
			return dir, nil
		}
	}
	return "", fmt.Errorf("project root not found")
}

// buildImage builds the Docker image from the project root if available,
// or from the embedded bundle otherwise.
func buildImage() error {
	root, err := findProjectRoot()
	if err == nil {
		return dockerBuild(root+"/docker/Dockerfile", root)
	}

	dbg("build: project root not found, using embedded bundle")
	dir, err := extractBundle()
	if err != nil {
		return fmt.Errorf("extract bundle: %w", err)
	}
	defer os.RemoveAll(dir)

	return dockerBuild(dir+"/docker/Dockerfile", dir)
}

func dockerBuild(dockerfile, context string) error {
	os.Setenv("DOCKER_BUILDKIT", "1")
	return dockerRun("build", "-t", image, "-f", dockerfile, context)
}

func parentDir(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return "/"
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

// getPort returns the mapped host port for a container port.
func getPort(container, containerPort string) string {
	out, err := dockerOutputSilent("port", container, containerPort)
	if err != nil || strings.TrimSpace(out) == "" {
		fmt.Fprintf(os.Stderr, "Error: could not find port %s for this browser\n", containerPort)
		os.Exit(exitInfra)
	}
	return parseHostPort(out)
}

// parseHostPort extracts the host port from docker port output. Handles
// multi-line output (IPv4+IPv6) by taking the first line, then the last
// colon-separated segment.
func parseHostPort(output string) string {
	line := strings.Split(strings.TrimSpace(output), "\n")[0]
	parts := strings.Split(line, ":")
	return parts[len(parts)-1]
}
