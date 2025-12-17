package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	systemdUnitPath  = "/etc/systemd/system/spectre-agent.service"
	launchdPlistPath = "/Library/LaunchDaemons/com.spectre.agent.plist"
	launchdLabel     = "com.spectre.agent"
)

func serviceUp(rawArgs []string) error {
	fs := flag.NewFlagSet("up", flag.ContinueOnError)
	listen := fs.String("listen", ":8081", "Address for the agent API and WebSocket server")
	token := fs.String("token", "changeme", "Auth token expected from the control server")
	host := fs.String("host", "", "Optional control server host (ws://host:port/agents/register) to initiate a connection")
	if err := fs.Parse(rawArgs); err != nil {
		return err
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	exe, _ = filepath.EvalSymlinks(exe)

	args := buildExecArgs(*listen, *token, *host)

	switch runtime.GOOS {
	case "linux":
		return installSystemdService(exe, args)
	case "darwin":
		return installLaunchdService(exe, args)
	default:
		return fmt.Errorf("service management is not supported on %s", runtime.GOOS)
	}
}

func serviceDown() error {
	switch runtime.GOOS {
	case "linux":
		return uninstallSystemdService()
	case "darwin":
		return uninstallLaunchdService()
	default:
		return fmt.Errorf("service management is not supported on %s", runtime.GOOS)
	}
}

func buildExecArgs(listen, token, host string) []string {
	args := []string{fmt.Sprintf("-listen=%s", listen), fmt.Sprintf("-token=%s", token)}
	if host != "" {
		args = append(args, fmt.Sprintf("-host=%s", host))
	}
	return args
}

func installSystemdService(exe string, args []string) error {
	content := fmt.Sprintf(`[Unit]
Description=Spectre agent
After=network.target

[Service]
Type=simple
ExecStart=%s %s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`, exe, strings.Join(args, " "))

	if err := os.WriteFile(systemdUnitPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("write unit: %w", err)
	}

	if err := runCommand("systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := runCommand("systemctl", "enable", "--now", "spectre-agent.service"); err != nil {
		return err
	}
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
</dict>
</plist>
`, launchdLabel, exe, launchdArgs(args))

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

func runCommand(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return nil
}
