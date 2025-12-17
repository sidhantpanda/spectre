package main

import "time"

const heartbeatInterval = 25 * time.Second

type DockerContainer struct {
	Name  string   `json:"name"`
	Ports []string `json:"ports"`
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
	Type        string            `json:"type"`
	AgentID     string            `json:"agentId,omitempty"`
	Fingerprint map[string]any    `json:"fingerprint,omitempty"`
	Data        string            `json:"data,omitempty"`
	SessionID   string            `json:"sessionId,omitempty"`
	Containers  []DockerContainer `json:"containers,omitempty"`
	Error       string            `json:"error,omitempty"`
}
