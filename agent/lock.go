package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

type AgentInstanceInfo struct {
	PID           int    `json:"pid"`
	AgentID       string `json:"agentId"`
	Listen        string `json:"listen"`
	ConnectionURL string `json:"connectionUrl"`
	Host          string `json:"host,omitempty"`
	Token         string `json:"token"`
	lockFilePath  string
}

func lockFilePath() string {
	return filepath.Join(os.TempDir(), "spectre-agent.lock")
}

// ensureSingleInstance attempts to acquire a simple lock so only one agent runs per machine.
// Returns true when lock is acquired, or false with info about the running agent.
func ensureSingleInstance(info AgentInstanceInfo) (bool, *AgentInstanceInfo, error) {
	path := lockFilePath()
	info.lockFilePath = path

	existing, err := readExistingInstance(path)
	if err == nil && processRunning(existing.PID) {
		return false, existing, nil
	}

	if err := writeInstance(path, info); err != nil {
		return false, nil, err
	}
	return true, nil, nil
}

func readExistingInstance(path string) (*AgentInstanceInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var info AgentInstanceInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, err
	}
	info.lockFilePath = path
	return &info, nil
}

func writeInstance(path string, info AgentInstanceInfo) error {
	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	// Best-effort overwrite if stale; if another process races we will fail.
	return os.WriteFile(path, data, 0o644)
}

func releaseSingleton(pid int) error {
	path := lockFilePath()
	info, err := readExistingInstance(path)
	if err != nil {
		// Nothing to release.
		return nil
	}
	if info.PID != pid {
		return errors.New("lock owned by another process")
	}
	return os.Remove(path)
}

func processRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return errors.Is(err, syscall.EPERM)
}
