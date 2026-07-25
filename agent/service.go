package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

const (
	systemdUnitPath  = "/etc/systemd/system/spectre-agent.service"
	launchdPlistPath = "/Library/LaunchDaemons/com.spectre.agent.plist"
	launchdLabel     = "com.spectre.agent"
)

func serviceUp(host, authKey string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	exe, _ = filepath.EvalSymlinks(exe)

	// The service runs with SPECTRE_AGENT_HOME pointed at its own state
	// directory, so enrollment has to write there too. Enrolling into the
	// invoking user's home instead leaves the service with no device key: it
	// enrols the machine a second time, and one host ends up as two entries on
	// the dashboard.
	if err := prepareServiceHome(); err != nil {
		return err
	}

	// Enrollment happens once, here, before the service is installed. The
	// device key is written to the device info file, so the auth key never
	// needs to appear in the unit file or in `ps` output.
	if err := enrollForService(host, authKey); err != nil {
		return err
	}

	// The file was just written by root; the service runs as the invoking user.
	if err := handServiceHomeToServiceAccount(); err != nil {
		return err
	}

	serviceArgs := buildExecArgs(host)

	var installErr error
	switch runtime.GOOS {
	case "linux":
		installErr = installSystemdService(exe, serviceArgs)
	case "darwin":
		installErr = installLaunchdService(exe, serviceArgs)
	default:
		return fmt.Errorf("service management is not supported on %s", runtime.GOOS)
	}

	if installErr != nil {
		return installErr
	}

	fmt.Println("\nspectre-agent service installed and started.")
	fmt.Println("  Check status:  spectre-agent status")
	switch runtime.GOOS {
	case "linux":
		fmt.Println("  View logs:     journalctl -u spectre-agent -f")
	case "darwin":
		fmt.Println("  View logs:     tail -f /var/log/spectre-agent.log")
	}
	fmt.Println("  Stop service:  sudo spectre-agent down")
	return nil
}

func serviceDown(purge bool) error {
	switch runtime.GOOS {
	case "linux":
		if err := uninstallSystemdService(); err != nil {
			return err
		}
	case "darwin":
		if err := uninstallLaunchdService(); err != nil {
			return err
		}
	default:
		return fmt.Errorf("service management is not supported on %s", runtime.GOOS)
	}

	_ = os.Remove(lockFilePath())

	if purge {
		purgeDataDirs()
	}

	fmt.Println("spectre-agent service stopped and removed.")
	if !purge {
		fmt.Println("  Device data preserved. Use --purge to also remove device keys and state.")
	}
	return nil
}
