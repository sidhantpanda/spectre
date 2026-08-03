package main

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strings"
)

func buildExecArgs(host string) []string {
	return []string{"run", fmt.Sprintf("--host=%s", host)}
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
	// Wired through so systemctl can put a polkit prompt in front of the user
	// when they run something privileged without sudo, rather than failing on a
	// prompt nobody can answer.
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return nil
}
