package main

import "time"

const heartbeatInterval = 25 * time.Second

type DockerContainer struct {
	Name  string   `json:"name"`
	Ports []string `json:"ports"`
}

type SystemInfo struct {
	OS             string `json:"os"`
	Version        string `json:"version"`
	CPU            string `json:"cpu"`
	Arch           string `json:"arch"`
	Cores          int    `json:"cores"`
	MemoryBytes    uint64 `json:"memoryBytes"`
	DiskTotalBytes uint64 `json:"diskTotalBytes"`
	DiskFreeBytes  uint64 `json:"diskFreeBytes"`
	TmuxAvailable  bool   `json:"tmuxAvailable"`
}

type NetworkInfo struct {
	IPv4 []string `json:"ipv4"`
	IPv6 []string `json:"ipv6"`
}

// SessionInfo describes one terminal session as the agent sees it.
//
// ID is the tmux session name, which is also what the control protocol uses to
// address the session. Sessions the agent created are named "spectre-<uuid>";
// sessions the user started themselves (over SSH, say) keep their own names and
// are reported with Managed false.
type SessionInfo struct {
	ID string `json:"id"`
	// CreatedAt is a Unix timestamp from tmux, absent for raw shells.
	CreatedAt int64 `json:"createdAt,omitempty"`
	// Attached reports whether any tmux client is currently viewing it.
	Attached bool `json:"attached"`
	Windows  int  `json:"windows,omitempty"`
	// Managed marks sessions Spectre created, as opposed to pre-existing ones.
	Managed bool `json:"managed"`
	// Live marks sessions this agent process currently holds a PTY for.
	Live bool `json:"live"`
}

// ControlMessage documents what the agent can receive from the control server.
type ControlMessage struct {
	Type string `json:"type"`
	// DeviceKey is set only on an "enrolled" message, when the server issues
	// this machine its long-lived credential.
	DeviceKey string `json:"deviceKey,omitempty"`
	Data      string `json:"data,omitempty"`
	// SessionID differentiates simultaneous PTY sessions.
	SessionID string `json:"sessionId,omitempty"`
	// Cols and Rows carry the browser terminal's geometry. Without them the PTY
	// keeps whatever size it was opened at, so full-screen programs and line
	// wrapping are laid out for a window the user is not looking at.
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
	// Version pins the release an "update" message should install. Empty means
	// whatever GitHub currently calls latest.
	Version string `json:"version,omitempty"`
}

// AgentMessage documents what the agent sends to the control server.
type AgentMessage struct {
	Type         string            `json:"type"`
	AgentID      string            `json:"agentId,omitempty"`
	AgentVersion string            `json:"agentVersion,omitempty"`
	Fingerprint  map[string]any    `json:"fingerprint,omitempty"`
	Data         string            `json:"data,omitempty"`
	SessionID    string            `json:"sessionId,omitempty"`
	Containers   []DockerContainer `json:"containers,omitempty"`
	SystemInfo   *SystemInfo       `json:"systemInfo,omitempty"`
	NetworkInfo  *NetworkInfo      `json:"networkInfo,omitempty"`
	Sessions     []SessionInfo     `json:"sessions,omitempty"`
	// TmuxAvailable tells the UI whether sessions can outlive a disconnect on
	// this host. Sent alongside a session list.
	TmuxAvailable bool   `json:"tmuxAvailable,omitempty"`
	Error         string `json:"error,omitempty"`
	// State reports progress of a self-update: started, installed or failed.
	State string `json:"state,omitempty"`
	// Version is the release an update targeted.
	Version string `json:"version,omitempty"`
}
