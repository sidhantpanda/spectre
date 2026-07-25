package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The service reads its device key from SPECTRE_AGENT_HOME. If `up` enrols into
// a different directory the service finds no key, enrols the machine a second
// time, and the dashboard shows one host as two entries: a disconnected row from
// the enrollment handshake, plus a fresh approval request.
func TestEnrollmentAndServiceAgreeOnTheDeviceKeyPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", home)

	if err := prepareServiceHome(); err != nil {
		t.Fatalf("prepareServiceHome: %v", err)
	}

	enrolled, err := deviceInfoPath()
	if err != nil {
		t.Fatalf("deviceInfoPath: %v", err)
	}
	if !strings.HasPrefix(enrolled, home) {
		t.Fatalf("enrollment writes to %s, outside the service home %s", enrolled, home)
	}

	unit := systemdUnit("/usr/local/bin/spectre-agent", buildExecArgs("wss://example.com"))
	if !strings.Contains(unit, "Environment=SPECTRE_AGENT_HOME="+home+"\n") {
		t.Fatalf("unit does not point the service at %s:\n%s", home, unit)
	}
}

func TestPrepareServiceHomeReusesAnExistingDeviceKey(t *testing.T) {
	// A machine enrolled by hand first: `run` stored its key under the invoking
	// user's home. Installing the service must reuse that device rather than
	// enrol a second one.
	userHome := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", userHome)
	if err := saveDeviceInfo(DeviceInfo{DeviceID: "device-1", DeviceKey: "dk_existing"}); err != nil {
		t.Fatalf("saveDeviceInfo: %v", err)
	}

	serviceHome := t.TempDir()
	original := defaultServiceAgentHome
	defaultServiceAgentHome = serviceHome
	defer func() { defaultServiceAgentHome = original }()

	// `up` runs with no SPECTRE_AGENT_HOME set, so the pre-existing key is
	// found through the invoking user's home.
	t.Setenv("SPECTRE_AGENT_HOME", "")
	t.Setenv("HOME", userHome)

	if err := prepareServiceHome(); err != nil {
		t.Fatalf("prepareServiceHome: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(serviceHome, ".spectre-agent", "device-info.json"))
	if err != nil {
		t.Fatalf("device info was not carried over to the service home: %v", err)
	}
	var info DeviceInfo
	if err := json.Unmarshal(data, &info); err != nil {
		t.Fatalf("parse device info: %v", err)
	}
	if info.DeviceKey != "dk_existing" || info.DeviceID != "device-1" {
		t.Fatalf("expected the existing device key to be reused, got %+v", info)
	}
}

// Identity is derived from the machine-id and MACs. Enrolling with only a
// hostname gives the device row an identity that can never match the same
// machine again, so a re-enrollment lands as a second entry.
func TestEnrollmentReportsTheFullFingerprint(t *testing.T) {
	fp := collectFingerprint()
	for _, key := range []string{"hostname", "machineId", "macAddresses", "nics"} {
		if _, ok := fp[key]; !ok {
			t.Fatalf("fingerprint sent at enrollment is missing %q: %v", key, fp)
		}
	}
}

// `status` is read-only. It used to call ensureDeviceInfo(), which mints an
// identity as a side effect — run as root that left a second device-info behind
// in root's home, and a later `run` there would enrol the machine again.
func TestStatusDoesNotCreateADeviceIdentity(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", home)
	original := defaultServiceAgentHome
	defaultServiceAgentHome = t.TempDir()
	defer func() { defaultServiceAgentHome = original }()

	if _, _, found := loadDeviceInfo(); found {
		t.Fatalf("expected no device info in a fresh home")
	}
	if _, err := os.Stat(filepath.Join(home, ".spectre-agent")); !os.IsNotExist(err) {
		t.Fatalf("reading device info created %s", filepath.Join(home, ".spectre-agent"))
	}

	if err := saveDeviceInfo(DeviceInfo{DeviceID: "device-1", DeviceKey: "dk_x"}); err != nil {
		t.Fatalf("saveDeviceInfo: %v", err)
	}
	info, path, found := loadDeviceInfo()
	if !found || info.DeviceID != "device-1" {
		t.Fatalf("expected to read back the stored identity, got %+v (%s)", info, path)
	}
}

// The service keeps its key in its own state directory. `status` run as a
// different user must report that, not claim the machine is unenrolled.
func TestLoadDeviceInfoFindsTheServiceHome(t *testing.T) {
	serviceHome := t.TempDir()
	original := defaultServiceAgentHome
	defaultServiceAgentHome = serviceHome
	defer func() { defaultServiceAgentHome = original }()

	t.Setenv("SPECTRE_AGENT_HOME", serviceHome)
	if err := saveDeviceInfo(DeviceInfo{DeviceID: "device-svc", DeviceKey: "dk_svc"}); err != nil {
		t.Fatalf("saveDeviceInfo: %v", err)
	}

	// Now look from an unrelated home, as an interactive `status` would.
	t.Setenv("SPECTRE_AGENT_HOME", t.TempDir())
	info, _, found := loadDeviceInfo()
	if !found || info.DeviceID != "device-svc" {
		t.Fatalf("expected the service's identity, got %+v (found=%v)", info, found)
	}
}
