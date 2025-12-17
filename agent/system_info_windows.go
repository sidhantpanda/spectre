//go:build windows

package main

import "strings"

// Best-effort disk detection on Windows via wmic output.
func detectDiskUsage() (uint64, uint64) {
	out := runSimpleCommand("wmic", "logicaldisk", "get", "size,freespace", "/value")
	// Output example:
	// FreeSpace=123456
	// Size=456789
	var free, total uint64
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "FreeSpace=") {
			free = parseUint(strings.TrimPrefix(line, "FreeSpace="))
		}
		if strings.HasPrefix(line, "Size=") {
			total = parseUint(strings.TrimPrefix(line, "Size="))
		}
		if free > 0 && total > 0 {
			break
		}
	}
	return total, free
}
