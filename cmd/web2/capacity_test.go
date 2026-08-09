package main

import "testing"

// C1: MemAvailable is the only line that matters, and it is reported in kB.
func TestParseMemAvailableMB(t *testing.T) {
	meminfo := `MemTotal:        8112528 kB
MemFree:          392324 kB
MemAvailable:    2383088 kB
Buffers:          123456 kB
`
	got, ok := parseMemAvailableMB(meminfo)
	if !ok {
		t.Fatal("MemAvailable not found in a well-formed /proc/meminfo")
	}
	if want := 2383088 / 1024; got != want {
		t.Errorf("available = %d MB, want %d MB", got, want)
	}
}

// C2: anything unparseable must report "unknown" rather than a wrong number -
// a bogus reading would either block every browser or wave them all through.
func TestParseMemAvailableMBRejectsGarbage(t *testing.T) {
	cases := map[string]string{
		"empty":              "",
		"no MemAvailable":    "MemTotal: 8112528 kB\nMemFree: 392324 kB\n",
		"non-numeric value":  "MemAvailable:    lots kB\n",
		"missing value":      "MemAvailable:\n",
		"similar prefix":     "MemAvailableFoo:  123 kB\n",
		"docker error text":  "Error response from daemon: container not running",
	}
	for name, meminfo := range cases {
		t.Run(name, func(t *testing.T) {
			if got, ok := parseMemAvailableMB(meminfo); ok {
				t.Errorf("accepted %q as %d MB", meminfo, got)
			}
		})
	}
}

// C4: `web2 doctor` turns free memory into the number a user actually wants:
// how many more browsers fit before the check starts refusing.
func TestEstimateBrowserSlots(t *testing.T) {
	cases := []struct {
		name       string
		available  int
		minFree    int
		perBrowser int
		want       int
	}{
		// available - minFree, in per-browser steps, plus the one that lands
		// exactly on the threshold.
		{"typical dev machine", 2282, 1024, 500, 3},
		{"exactly at the threshold", 1024, 1024, 500, 1},
		{"one MB below the threshold", 1023, 1024, 500, 0},
		{"nothing available", 0, 1024, 500, 0},
		{"roomy", 5000, 1024, 500, 8},
		// Threshold disabled: memory is the only limit.
		{"threshold off", 2000, 0, 500, 4},
		{"threshold off, negative", 2000, -1, 500, 4},
		{"threshold off, too little for one", 100, 0, 500, 0},
		// Never divide by zero on a nonsense estimate.
		{"zero per-browser estimate", 2000, 1024, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := estimateBrowserSlots(tc.available, tc.minFree, tc.perBrowser)
			if got != tc.want {
				t.Errorf("estimateBrowserSlots(%d, %d, %d) = %d, want %d",
					tc.available, tc.minFree, tc.perBrowser, got, tc.want)
			}
		})
	}
}

// C5: MemTotal is read from the same source as MemAvailable.
func TestParseMemTotalMB(t *testing.T) {
	meminfo := "MemTotal:        8112528 kB\nMemAvailable:    2383088 kB\n"
	got, ok := parseMeminfoFieldMB(meminfo, "MemTotal:")
	if !ok || got != 8112528/1024 {
		t.Errorf("MemTotal = %d MB (ok=%v), want %d MB", got, ok, 8112528/1024)
	}
}

// C3: the decision itself. web2 refuses only when it knows there is no room.
func TestRoomForBrowser(t *testing.T) {
	cases := []struct {
		name        string
		available   int
		minFree     int
		wantRoom    bool
	}{
		{"plenty of memory", 4096, 1024, true},
		{"exactly at the threshold", 1024, 1024, true},
		{"one MB short", 1023, 1024, false},
		{"almost nothing left", 12, 1024, false},
		{"threshold disabled with 0", 12, 0, true},
		{"threshold disabled with a negative value", 12, -1, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := roomForBrowser(tc.available, tc.minFree); got != tc.wantRoom {
				t.Errorf("roomForBrowser(%d, %d) = %v, want %v",
					tc.available, tc.minFree, got, tc.wantRoom)
			}
		})
	}
}
