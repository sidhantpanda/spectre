package main

import "time"

const heartbeatInterval = 25 * time.Second

// ControlMessage documents what the agent can receive from the control server.
type ControlMessage struct {
	Type  string `json:"type"`
	Token string `json:"token,omitempty"`
	Data  string `json:"data,omitempty"`
}

// AgentMessage documents what the agent sends to the control server.
type AgentMessage struct {
	Type        string         `json:"type"`
	AgentID     string         `json:"agentId,omitempty"`
	Fingerprint map[string]any `json:"fingerprint,omitempty"`
	Data        string         `json:"data,omitempty"`
}
