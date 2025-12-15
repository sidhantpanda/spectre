package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type DeviceInfo struct {
	DeviceID string `json:"deviceId"`
}

func deviceInfoPath() (string, error) {
	home := os.Getenv("SPECTRE_AGENT_HOME")
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	return filepath.Join(home, ".spectre-agent", "device-info.json"), nil
}

func ensureDeviceInfo() (DeviceInfo, error) {
	path, err := deviceInfoPath()
	if err != nil {
		return DeviceInfo{}, err
	}

	if data, err := os.ReadFile(path); err == nil {
		var info DeviceInfo
		if json.Unmarshal(data, &info) == nil && info.DeviceID != "" {
			return info, nil
		}
	}

	info := DeviceInfo{DeviceID: generateDeviceID()}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return DeviceInfo{}, err
	}

	payload, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return DeviceInfo{}, err
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		return DeviceInfo{}, err
	}
	return info, nil
}

func generateDeviceID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
