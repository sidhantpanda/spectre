package main

import (
	"crypto/rand"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Sessions the agent creates are named "spectre-<uuid>". The bare "spectre"
// name is what single-session agents used before multi-session support; it is
// still recognised so an upgraded agent adopts the old session instead of
// stranding it.
const (
	spectreSessionPrefix = "spectre-"
	legacySessionName    = "spectre"
)

func isManagedSessionName(name string) bool {
	return name == legacySessionName || strings.HasPrefix(name, spectreSessionPrefix)
}

// tmuxListFormat is the -F template parseTmuxSessions expects.
const tmuxListFormat = "#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}"

// parseTmuxSessions turns `tmux list-sessions -F tmuxListFormat` output into
// session records. Kept separate from the exec call so it can be tested on
// machines without tmux installed.
func parseTmuxSessions(out string) []SessionInfo {
	var sessions []SessionInfo
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 4 {
			continue
		}
		created, _ := strconv.ParseInt(parts[1], 10, 64)
		windows, _ := strconv.Atoi(parts[3])
		sessions = append(sessions, SessionInfo{
			ID:        parts[0],
			CreatedAt: created,
			Attached:  parts[2] != "0",
			Windows:   windows,
			Managed:   isManagedSessionName(parts[0]),
		})
	}
	return sessions
}

// newSessionID mints a "spectre-<uuid>" name. The agent has no uuid dependency,
// so this formats random bytes as a v4 UUID rather than pulling one in.
func newSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%s%d", spectreSessionPrefix, time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s%x-%x-%x-%x-%x", spectreSessionPrefix, b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
