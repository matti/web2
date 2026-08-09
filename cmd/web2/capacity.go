package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Capacity check before starting a browser.
//
// This replaced a fixed cap on the number of browsers (WEB2_MAX_SESSIONS,
// default 8), which measured the wrong thing: it counted only web2's own
// containers, while the scarce resource is memory shared with everything else
// in the same Docker VM. Measured on a dev machine: 47 unrelated containers
// held 5.7 GB of the VM's 7.7 GB, leaving room for about four browsers - and
// the cap would still have waved eight through.
//
// Containers share the VM's kernel, so /proc/meminfo read from inside any
// running browser reports the whole VM, not that container's own limit
// (verified: MemTotal matches `docker info` exactly, not the 2g cgroup cap).
//
// Nothing is ever auto-evicted: killing someone else's browser to make room
// would break the isolation promise.

// defaultMinFreeMB is the headroom required before starting another browser.
// A browser measured 350-480 MB idle on a light page; the margin covers
// heavier pages and short-lived spikes.
const defaultMinFreeMB = 1024

func checkCapacity() {
	minFree := envInt("WEB2_MIN_FREE_MB", defaultMinFreeMB)
	available, ok := availableMemoryMB()
	if !ok {
		// No browser running to ask, or docker did not answer. The first
		// browser always starts; if it genuinely does not fit, docker run
		// fails with its own message.
		return
	}
	if roomForBrowser(available, minFree) {
		return
	}
	fmt.Fprintf(os.Stderr,
		"Error: not enough memory for another browser (%d MB available, %d MB needed).\n"+
			"Free capacity in Docker or raise its memory limit, then retry.\n",
		available, minFree)
	os.Exit(exitInfra)
}

// roomForBrowser reports whether another browser fits. A non-positive
// threshold disables the check.
func roomForBrowser(availableMB, minFreeMB int) bool {
	return minFreeMB <= 0 || availableMB >= minFreeMB
}

// availableMemoryMB reads MemAvailable through any running browser. Returns
// false when there is none, which is also the "first browser" case.
func availableMemoryMB() (int, bool) {
	container, ok := anyRunningBrowser()
	if !ok {
		return 0, false
	}
	meminfo, err := dockerOutputSilent("exec", container, "cat", "/proc/meminfo")
	if err != nil {
		return 0, false
	}
	return parseMemAvailableMB(meminfo)
}

// anyRunningBrowser returns the id of some running web2 container. Which one
// makes no difference: they all report the same VM.
func anyRunningBrowser() (string, bool) {
	out, err := dockerOutputSilent("ps", "-q", "--filter", "label=web2=true")
	if err != nil {
		return "", false
	}
	id := strings.TrimSpace(out)
	if id == "" {
		return "", false
	}
	if nl := strings.IndexByte(id, '\n'); nl >= 0 {
		id = id[:nl]
	}
	return id, true
}

// parseMemAvailableMB pulls MemAvailable (kB) out of /proc/meminfo text.
// Anything unparseable reports "unknown" rather than a guess.
func parseMemAvailableMB(meminfo string) (int, bool) {
	return parseMeminfoFieldMB(meminfo, "MemAvailable:")
}

// parseMeminfoFieldMB reads one kB-valued /proc/meminfo field.
func parseMeminfoFieldMB(meminfo, field string) (int, bool) {
	for _, line := range strings.Split(meminfo, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] != field {
			continue
		}
		kb, err := strconv.Atoi(fields[1])
		if err != nil {
			return 0, false
		}
		return kb / 1024, true
	}
	return 0, false
}

// typicalBrowserMB is what one browser was measured to hold on a light page
// (350-480 MB). Used only to turn free memory into a human estimate in
// `web2 doctor`; the capacity decision itself never guesses.
const typicalBrowserMB = 500

// estimateBrowserSlots reports how many more browsers fit before checkCapacity
// starts refusing: each one consumes perBrowserMB, and the last one allowed is
// the one that still leaves minFreeMB available.
func estimateBrowserSlots(availableMB, minFreeMB, perBrowserMB int) int {
	if perBrowserMB <= 0 {
		return 0
	}
	if minFreeMB <= 0 {
		return availableMB / perBrowserMB
	}
	if availableMB < minFreeMB {
		return 0
	}
	return (availableMB-minFreeMB)/perBrowserMB + 1
}

// probeMemoryMB reports the Docker VM's total and available memory for
// diagnostics. It prefers a running browser, and falls back to a throwaway
// container when there is none: too slow for the start path, fine here.
func probeMemoryMB() (total, available int, ok bool) {
	meminfo, ok := readMeminfo()
	if !ok {
		return 0, 0, false
	}
	total, totalOK := parseMeminfoFieldMB(meminfo, "MemTotal:")
	available, availOK := parseMemAvailableMB(meminfo)
	return total, available, totalOK && availOK
}

func readMeminfo() (string, bool) {
	if container, ok := anyRunningBrowser(); ok {
		if out, err := dockerOutputSilent("exec", container, "cat", "/proc/meminfo"); err == nil {
			return out, true
		}
	}
	if !imageExists(image) {
		return "", false
	}
	out, err := dockerOutputSilent("run", "--rm", "--entrypoint", "cat", image, "/proc/meminfo")
	if err != nil {
		return "", false
	}
	return out, true
}
