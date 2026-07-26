package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func cmdDoctor(args []string) {
	for _, a := range args {
		if a == "-h" || a == "--help" {
			fmt.Println("Usage: web2 doctor")
			fmt.Println("Check system requirements (Docker, image)")
			os.Exit(0)
		}
	}

	ok := true
	fmt.Println("Checking system requirements...")

	dockerPath, err := exec.LookPath("docker")
	if err != nil {
		fmt.Println("  Docker: NOT FOUND")
		ok = false
	} else {
		out, _ := dockerOutputSilent("--version")
		fmt.Printf("  Docker: %s (%s)\n", strings.TrimSpace(out), dockerPath)
	}

	if err := exec.Command("docker", "info").Run(); err != nil {
		fmt.Println("  Docker daemon: NOT RUNNING")
		ok = false
	} else {
		fmt.Println("  Docker daemon: running")
	}

	if imageExists(image) {
		fmt.Printf("  Image %s: found\n", image)
	} else {
		fmt.Printf("  Image %s: not built (builds automatically on first command)\n", image)
	}

	if ok {
		fmt.Println("All good!")
	} else {
		fmt.Fprintln(os.Stderr, "Issues found.")
		os.Exit(exitInfra)
	}
}

// cmdOpen opens a viewer into the caller's OWN browser (starting it if
// needed) — never anyone else's.
func cmdOpen(args []string) {
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		fmt.Fprint(os.Stderr, `Usage: web2 open <command>

Commands:
  vnc     Open VNC viewer (macOS)
  novnc   Open noVNC in a browser
`)
		os.Exit(0)
	}

	switch args[0] {
	case "vnc", "novnc":
		owner := currentOwner()
		ctr := ensureContainer(owner)
		openViewer(args[0], ctr)
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown open target %q. Use: vnc, novnc\n", args[0])
		os.Exit(exitUsage)
	}
}
