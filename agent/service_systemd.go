package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func installSystemdService(exe string, args []string) error {
	if err := os.WriteFile(systemdUnitPath, []byte(systemdUnit(exe, args)), 0644); err != nil {
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

func systemdUnit(exe string, args []string) string {
	userName, groupName := resolveServiceAccount()
	var sb strings.Builder
	sb.WriteString("[Unit]\n")
	sb.WriteString("Description=Spectre agent\n")
	sb.WriteString("After=network.target\n\n")

	sb.WriteString("[Service]\n")
	sb.WriteString("Type=simple\n")
	sb.WriteString("Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin\n")
	sb.WriteString("Environment=SPECTRE_AGENT_HOME=" + serviceAgentHome() + "\n")
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

	return sb.String()
}

func uninstallSystemdService() error {
	_ = runCommand("systemctl", "disable", "--now", "spectre-agent.service")
	if err := os.Remove(systemdUnitPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove unit: %w", err)
	}
	_ = runCommand("systemctl", "daemon-reload")
	return nil
}
