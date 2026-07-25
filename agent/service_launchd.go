package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

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
  <key>EnvironmentVariables</key>
  <dict>
    <key>SPECTRE_AGENT_HOME</key><string>%s</string>
  </dict>
  <key>StandardOutPath</key><string>/var/log/spectre-agent.log</string>
  <key>StandardErrorPath</key><string>/var/log/spectre-agent.log</string>
%s
</dict>
</plist>
`, launchdLabel, exe, launchdArgs(args), serviceAgentHome(), userLine)

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
