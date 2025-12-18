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
}

type NetworkInfo struct {
	IPv4 []string `json:"ipv4"`
	IPv6 []string `json:"ipv6"`
}

// ControlMessage documents what the agent can receive from the control server.
type ControlMessage struct {
	Type  string `json:"type"`
	Token string `json:"token,omitempty"`
	Data  string `json:"data,omitempty"`
	// SessionID differentiates simultaneous PTY sessions.
	SessionID string `json:"sessionId,omitempty"`
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
	Error        string            `json:"error,omitempty"`
}
