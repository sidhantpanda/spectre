package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureDeviceInfoPersists(t *testing.T) {
	t.Setenv("SPECTRE_AGENT_HOME", t.TempDir())

	info, err := ensureDeviceInfo()
	if err != nil {
		t.Fatalf("ensureDeviceInfo returned error: %v", err)
	}
	if info.DeviceID == "" {
		t.Fatalf("expected device id to be set")
	}

	again, err := ensureDeviceInfo()
	if err != nil {
		t.Fatalf("second ensureDeviceInfo returned error: %v", err)
	}
	if again.DeviceID != info.DeviceID {
		t.Fatalf("expected stable device id, got %s and %s", info.DeviceID, again.DeviceID)
	}

	path, err := deviceInfoPath()
	if err != nil {
		t.Fatalf("deviceInfoPath failed: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read device info file: %v", err)
	}
	var stored DeviceInfo
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("failed to parse device info: %v", err)
	}
	if stored.DeviceID != info.DeviceID {
		t.Fatalf("expected stored device id to match, got %s", stored.DeviceID)
	}

	if _, err := os.Stat(filepath.Dir(path)); err != nil {
		t.Fatalf("expected device info directory to exist: %v", err)
	}
}
