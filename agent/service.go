package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
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

	// Enrollment happens once, here, before the service is installed. The
	// device key is written to the device info file, so the auth key never
	// needs to appear in the unit file or in `ps` output.
	if err := enrollForService(host, authKey); err != nil {
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

func purgeDataDirs() {
	dirs := []string{}

	if p, err := deviceInfoPath(); err == nil {
		dirs = append(dirs, filepath.Dir(p))
	}

	sysDir := "/var/lib/spectre-agent"
	if _, err := os.Stat(sysDir); err == nil {
		dirs = append(dirs, sysDir)
	}

	for _, d := range dirs {
		if err := os.RemoveAll(d); err != nil {
			fmt.Printf("  warning: could not remove %s: %v\n", d, err)
		} else {
			fmt.Printf("  removed %s\n", d)
		}
	}
}

// enrollForService makes sure this machine holds a device key before the
// service is installed, so the service itself starts with no secret on its
// command line. An already-enrolled machine is left alone.
func enrollForService(host, authKey string) error {
	info, err := ensureDeviceInfo()
	if err != nil {
		return fmt.Errorf("read device info: %w", err)
	}
	if info.DeviceKey != "" {
		fmt.Println("This machine is already enrolled.")
		return nil
	}

	if authKey != "" {
		fmt.Println("Enrolling with control server...")
		key, err := enrollWithAuthKey(host, authKey, info.DeviceID)
		if err != nil {
			return fmt.Errorf("enrollment failed: %w", err)
		}
		info.DeviceKey = key
	} else {
		key, err := enrollInteractively(host, info.DeviceID)
		if err != nil {
			return err
		}
		info.DeviceKey = key
	}

	if err := saveDeviceInfo(info); err != nil {
		return fmt.Errorf("store device key: %w", err)
	}
	fmt.Println("Enrolled. Device key stored.")
	return nil
}

func buildExecArgs(host string) []string {
	return []string{"run", fmt.Sprintf("--host=%s", host)}
}

func installSystemdService(exe string, args []string) error {
	userName, groupName := resolveServiceAccount()
	var sb strings.Builder
	sb.WriteString("[Unit]\n")
	sb.WriteString("Description=Spectre agent\n")
	sb.WriteString("After=network.target\n\n")

	sb.WriteString("[Service]\n")
	sb.WriteString("Type=simple\n")
	sb.WriteString("Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin\n")
	sb.WriteString("Environment=SPECTRE_AGENT_HOME=/var/lib/spectre-agent\n")
	sb.WriteString("StateDirectory=spectre-agent\n")
	if userName != "" {
		sb.WriteString("User=" + userName + "\n")
	}
	if groupName != "" {
		sb.WriteString("Group=" + groupName + "\n")
	}
	sb.WriteString(fmt.Sprintf("ExecStart=%s %s\n", exe, strings.Join(args, " ")))
	sb.WriteString(fmt.Sprintf("WorkingDirectory=%s\n", filepath.Dir(exe)))
	sb.WriteString("Restart=always\n")
	sb.WriteString("RestartSec=5\n\n")

	sb.WriteString("[Install]\n")
	sb.WriteString("WantedBy=multi-user.target\n")

	content := sb.String()

	if err := os.WriteFile(systemdUnitPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("write unit: %w", err)
	}

	if err := runCommand("systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := runCommand("systemctl", "enable", "--now", "spectre-agent.service"); err != nil {
		return err
	}

	// Show status for quick troubleshooting when invoked interactively.
	_ = runCommand("systemctl", "status", "--no-pager", "spectre-agent.service")
	return nil
}

func uninstallSystemdService() error {
	_ = runCommand("systemctl", "disable", "--now", "spectre-agent.service")
	if err := os.Remove(systemdUnitPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove unit: %w", err)
	}
	_ = runCommand("systemctl", "daemon-reload")
	return nil
}

func installLaunchdService(exe string, args []string) error {
	userName, _ := resolveServiceAccount()
	var userLine string
	if userName != "" {
		userLine = fmt.Sprintf("  <key>UserName</key><string>%s</string>\n", userName)
	}

	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
    %s
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/spectre-agent.log</string>
  <key>StandardErrorPath</key><string>/var/log/spectre-agent.log</string>
%s
</dict>
</plist>
`, launchdLabel, exe, launchdArgs(args), userLine)

	if err := os.WriteFile(launchdPlistPath, []byte(plist), 0644); err != nil {
		return fmt.Errorf("write plist: %w", err)
	}

	_ = runCommand("launchctl", "bootout", fmt.Sprintf("system/%s", launchdLabel))
	if err := runCommand("launchctl", "bootstrap", "system", launchdPlistPath); err != nil {
		return err
	}
	_ = runCommand("launchctl", "enable", fmt.Sprintf("system/%s", launchdLabel))
	_ = runCommand("launchctl", "kickstart", "-k", fmt.Sprintf("system/%s", launchdLabel))
	return nil
}

func uninstallLaunchdService() error {
	_ = runCommand("launchctl", "bootout", fmt.Sprintf("system/%s", launchdLabel))
	if err := os.Remove(launchdPlistPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove plist: %w", err)
	}
	return nil
}

func launchdArgs(args []string) string {
	if len(args) == 0 {
		return ""
	}
	var b strings.Builder
	for _, a := range args {
		b.WriteString("    <string>")
		b.WriteString(a)
		b.WriteString("</string>\n")
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func resolveServiceAccount() (string, string) {
	// Prefer the user who invoked via sudo; fallback to current user.
	name := os.Getenv("SUDO_USER")
	if name == "" {
		name = os.Getenv("USER")
	}
	if name == "" || name == "root" {
		return "", ""
	}

	u, err := user.Lookup(name)
	if err != nil {
		return name, ""
	}

	group := ""
	if g, err := user.LookupGroupId(u.Gid); err == nil {
		group = g.Name
	}
	if group == "" {
		group = u.Username
	}

	return u.Username, group
}

func runCommand(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return nil
}
