package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func showStatus() error {
	fmt.Printf("spectre-agent %s\n\n", getAgentVersion())

	running, info := checkRunning()
	if running && info != nil {
		fmt.Printf("  Status:    running (pid %d)\n", info.PID)
		fmt.Printf("  Agent ID:  %s\n", info.AgentID)
		if info.Host != "" {
			fmt.Printf("  Server:    %s\n", info.Host)
		}
	} else {
		fmt.Println("  Status:    not running")
	}

	deviceInfo, infoPath, found := loadDeviceInfo()
	if found {
		fmt.Printf("  Device ID: %s\n", deviceInfo.DeviceID)
		if deviceInfo.DeviceKey != "" {
			fmt.Println("  Enrolled:  yes")
		} else {
			fmt.Println("  Enrolled:  no")
		}
		fmt.Printf("  Data dir:  %s\n", filepath.Dir(infoPath))
	} else {
		fmt.Println("  Enrolled:  no")
		if path, _ := deviceInfoPath(); path != "" {
			fmt.Printf("  Data dir:  %s (empty)\n", filepath.Dir(path))
		}
	}

	if svcStatus := serviceStatus(); svcStatus != "" {
		fmt.Printf("  Service:   %s\n", svcStatus)
	}
	return nil
}

func checkRunning() (bool, *AgentInstanceInfo) {
	info, err := readExistingInstance(lockFilePath())
	if err != nil {
		return false, nil
	}
	if processRunning(info.PID) {
		return true, info
	}
	return false, nil
}

func serviceStatus() string {
	switch runtime.GOOS {
	case "linux":
		if _, err := os.Stat(systemdUnitPath); err != nil {
			return "not installed"
		}
		out, err := exec.Command("systemctl", "is-active", "spectre-agent.service").Output()
		if err != nil {
			return "installed (inactive)"
		}
		return "installed (" + strings.TrimSpace(string(out)) + ")"
	case "darwin":
		if _, err := os.Stat(launchdPlistPath); err != nil {
			return "not installed"
		}
		return "installed"
	default:
		return ""
	}
}
