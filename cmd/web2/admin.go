package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// cmdAdmin is the human-only surface: the only place where other owners'
// browsers are visible or destroyable. Agents are gated out (E8) unless the
// user explicitly authorizes them with WEB2_ADMIN=1.
func cmdAdmin(args []string) {
	if agentGateBlocked() {
		fmt.Fprintln(os.Stderr, "Error: admin commands are human-only; the user can run this, or set WEB2_ADMIN=1 to authorize you")
		os.Exit(exitInfra)
	}
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		fmt.Fprint(os.Stderr, `Usage: web2 admin <command>   (human only)

Commands:
  list [--json]                List all web2 browsers with owners
  destroy <name|--mine|--all>  Destroy browsers
  vnc [name]                   Open VNC viewer (own browser if omitted)
  novnc [name]                 Open noVNC in a browser (own if omitted)
  rebuild                      Rebuild the Docker image, reset own browser
`)
		os.Exit(0)
	}

	switch args[0] {
	case "list":
		adminList(args[1:])
	case "destroy":
		adminDestroy(args[1:])
	case "vnc", "novnc":
		adminViewer(args[0], args[1:])
	case "rebuild":
		adminRebuild()
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown admin command %q. Use: list, destroy, vnc, novnc, rebuild\n", args[0])
		os.Exit(exitUsage)
	}
}

// agentGateBlocked reports whether the caller is an agent without explicit
// admin authorization.
func agentGateBlocked() bool {
	if os.Getenv("WEB2_ADMIN") == "1" {
		return false
	}
	return os.Getenv("CLAUDECODE") != "" || os.Getenv("AI_AGENT") != ""
}

type adminEntry struct {
	Name     string `json:"name"`
	OwnerKey string `json:"ownerKey"`
	Kind     string `json:"kind"`
	State    string `json:"state"`
	Status   string `json:"status"`
}

func listEntries() []adminEntry {
	out, err := dockerOutputSilent("ps", "-a", "--filter", "label=web2=true", "--format",
		"{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Label \"web2.owner.kind\"}}\t{{.Label \"web2.owner.key\"}}")
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error: docker not available; run 'web2 doctor'")
		os.Exit(exitInfra)
	}
	var entries []adminEntry
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 5 {
			continue
		}
		entries = append(entries, adminEntry{
			Name: parts[0], State: parts[1], Status: parts[2], Kind: parts[3], OwnerKey: parts[4],
		})
	}
	return entries
}

func adminList(args []string) {
	entries := listEntries()
	for _, a := range args {
		if a == "--json" {
			b, _ := json.Marshal(entries)
			fmt.Println(string(b))
			return
		}
	}
	if len(entries) == 0 {
		fmt.Println("No web2 browsers running.")
		return
	}
	fmt.Printf("%-18s %-8s %-22s %-6s %s\n", "NAME", "STATE", "STATUS", "KIND", "OWNER")
	for _, e := range entries {
		fmt.Printf("%-18s %-8s %-22s %-6s %s\n", e.Name, e.State, e.Status, e.Kind, e.OwnerKey)
	}
}

func adminDestroy(args []string) {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "Usage: web2 admin destroy <name|--mine|--all>")
		os.Exit(exitUsage)
	}
	switch args[0] {
	case "--all":
		n := 0
		for _, e := range listEntries() {
			dockerOutputSilent("rm", "-f", e.Name)
			n++
		}
		fmt.Fprintf(os.Stderr, "Destroyed %d browser(s).\n", n)
	case "--mine":
		ctr := currentOwner().ContainerName()
		if _, err := dockerOutputSilent("rm", "-f", ctr); err != nil {
			fmt.Fprintln(os.Stderr, "No browser to destroy.")
			return
		}
		fmt.Fprintf(os.Stderr, "Destroyed %s.\n", ctr)
	default:
		name := args[0]
		if !strings.HasPrefix(name, prefix) {
			name = prefix + name
		}
		// Only touch containers carrying the web2 label.
		found := false
		for _, e := range listEntries() {
			if e.Name == name {
				found = true
				break
			}
		}
		if !found {
			fmt.Fprintf(os.Stderr, "Error: no web2 browser named %q\n", name)
			os.Exit(exitCommand)
		}
		dockerOutputSilent("rm", "-f", name)
		fmt.Fprintf(os.Stderr, "Destroyed %s.\n", name)
	}
}

func adminViewer(kind string, args []string) {
	ctr := currentOwner().ContainerName()
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		ctr = args[0]
		if !strings.HasPrefix(ctr, prefix) {
			ctr = prefix + ctr
		}
	}
	if !containerRunning(ctr) {
		fmt.Fprintf(os.Stderr, "Error: browser %q is not running\n", ctr)
		os.Exit(exitCommand)
	}
	openViewer(kind, ctr)
}

// openViewer opens the VNC/noVNC view of a container (shared with `web2 open`).
func openViewer(kind, ctr string) {
	switch kind {
	case "vnc":
		port := getPort(ctr, "5900")
		url := fmt.Sprintf("vnc://:secret@127.0.0.1:%s", port)
		fmt.Fprintln(os.Stderr, url)
		exec.Command("open", url).Run()
	case "novnc":
		port := getPort(ctr, "6080")
		url := fmt.Sprintf("http://127.0.0.1:%s/vnc.html?autoconnect=true&password=secret&resize=scale&reconnect=true&reconnect_delay=500", port)
		fmt.Fprintln(os.Stderr, url)
		exec.Command("open", url).Run()
	}
}

func adminRebuild() {
	fmt.Fprintln(os.Stderr, "Rebuilding web2 Docker image...")
	if err := buildImage(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: docker build failed: %v\n", err)
		os.Exit(exitInfra)
	}
	ctr := currentOwner().ContainerName()
	dockerOutputSilent("rm", "-f", ctr)
	fmt.Fprintln(os.Stderr, "Image rebuilt; your browser will start fresh on the next command.")
}
