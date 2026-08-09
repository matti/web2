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
