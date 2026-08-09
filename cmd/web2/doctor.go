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

	reportCapacity()

	if ok {
		fmt.Println("All good!")
	} else {
		fmt.Fprintln(os.Stderr, "Issues found.")
		os.Exit(exitInfra)
	}
}

// reportCapacity shows the limit that decides whether another browser may
// start. Since capacity became memory-based it is no longer a fixed number a
// user can look up, so doctor is where it becomes visible.
//
// Deliberately prints no browser count: how many browsers exist, and whose
// they are, is not the agent surface's business (web2.md P0). Free memory is
// a property of the machine and says nothing about who else is running.
func reportCapacity() {
	total, available, ok := probeMemoryMB()
	if !ok {
		fmt.Println("  Docker VM memory: unknown (needs the image or a running browser)")
		return
	}
	fmt.Printf("  Docker VM memory: %d of %d MB available\n", available, total)

	minFree := envInt("WEB2_MIN_FREE_MB", defaultMinFreeMB)
	if minFree <= 0 {
		fmt.Printf("  Browser capacity: check disabled (WEB2_MIN_FREE_MB=%d)\n", minFree)
		return
	}
	slots := estimateBrowserSlots(available, minFree, typicalBrowserMB)
	fmt.Printf("  Browser capacity: room for ~%d more (~%d MB each, refuses below %d MB free)\n",
		slots, typicalBrowserMB, minFree)
	if slots == 0 {
		fmt.Println("    Free capacity in Docker or raise its memory limit before starting one.")
	}
}

// cmdOpen opens a viewer into the caller's OWN browser (starting it if
// needed) - never anyone else's.
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
