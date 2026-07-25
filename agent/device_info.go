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
	DeviceID  string `json:"deviceId"`
	DeviceKey string `json:"deviceKey,omitempty"`
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

// loadDeviceInfo reads this machine's identity without creating one, and says
// where it found it.
//
// Anything that only reports state has to use this. ensureDeviceInfo() mints a
// fresh device id as a side effect, so running `status` as root used to leave a
// second identity behind in root's home — which a later `run` would enrol as a
// second machine.
func loadDeviceInfo() (DeviceInfo, string, bool) {
	seen := map[string]bool{}
	candidates := []string{}
	if path, err := deviceInfoPath(); err == nil {
		candidates = append(candidates, path)
	}
	// The installed service keeps its key in its own state directory, which is
	// not where an interactive `status` would look.
	for _, home := range []string{serviceAgentHome(), defaultServiceAgentHome} {
		candidates = append(candidates, filepath.Join(home, ".spectre-agent", "device-info.json"))
	}

	for _, path := range candidates {
		if seen[path] {
			continue
		}
		seen[path] = true
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var info DeviceInfo
		if json.Unmarshal(data, &info) != nil || info.DeviceID == "" {
			continue
		}
		return info, path, true
	}
	return DeviceInfo{}, "", false
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
	if err := saveDeviceInfo(info); err != nil {
		return DeviceInfo{}, err
	}
	return info, nil
}

// saveDeviceInfo persists the device identity and key.
//
// The device key is a permanent credential for a shell on this machine, so the
// file is owner-only: 0644 would hand every local user the ability to
// impersonate this device to the control server.
func saveDeviceInfo(info DeviceInfo) error {
	path, err := deviceInfoPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}

	// Write-then-rename so a crash cannot leave a truncated key behind, and so
	// the key is never briefly visible at a wider mode.
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	// Tighten an existing file that a previous version created world-readable.
	_ = os.Chmod(path, 0o600)
	_ = os.Chmod(filepath.Dir(path), 0o700)
	return nil
}

func generateDeviceID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
