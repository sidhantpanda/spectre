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

// The device key is a permanent credential for a shell on this machine. If the
// file is readable by other local users, any of them can impersonate it.
func TestDeviceInfoIsNotReadableByOtherUsers(t *testing.T) {
	t.Setenv("SPECTRE_AGENT_HOME", t.TempDir())

	info, err := ensureDeviceInfo()
	if err != nil {
		t.Fatalf("ensureDeviceInfo returned error: %v", err)
	}
	info.DeviceKey = "dk_secret"
	if err := saveDeviceInfo(info); err != nil {
		t.Fatalf("saveDeviceInfo returned error: %v", err)
	}

	path, err := deviceInfoPath()
	if err != nil {
		t.Fatalf("deviceInfoPath failed: %v", err)
	}

	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat device info: %v", err)
	}
	if mode := fi.Mode().Perm(); mode != 0o600 {
		t.Fatalf("device info mode = %#o, want 0600", mode)
	}

	di, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatalf("stat device dir: %v", err)
	}
	if mode := di.Mode().Perm(); mode != 0o700 {
		t.Fatalf("device dir mode = %#o, want 0700", mode)
	}
}

// A key written by an older version at 0644 must be tightened, not left as-is.
func TestSaveDeviceInfoTightensExistingPermissions(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", home)

	path, err := deviceInfoPath()
	if err != nil {
		t.Fatalf("deviceInfoPath failed: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"deviceId":"old","deviceKey":"dk_old"}`), 0o644); err != nil {
		t.Fatalf("seed legacy file: %v", err)
	}

	info, err := ensureDeviceInfo()
	if err != nil {
		t.Fatalf("ensureDeviceInfo returned error: %v", err)
	}
	if err := saveDeviceInfo(info); err != nil {
		t.Fatalf("saveDeviceInfo returned error: %v", err)
	}

	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat device info: %v", err)
	}
	if mode := fi.Mode().Perm(); mode != 0o600 {
		t.Fatalf("legacy device info left at %#o, want 0600", mode)
	}
}
