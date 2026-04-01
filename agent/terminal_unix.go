//go:build !windows

package main

import (
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"

	"github.com/creack/pty"
)

var tmuxCheckOnce sync.Once
var tmuxPath string

func isTmuxAvailable() bool {
	tmuxCheckOnce.Do(func() {
		path, err := exec.LookPath("tmux")
		if err == nil {
			tmuxPath = path
		}
	})
	return tmuxPath != ""
}

func sanitizeTmuxName(name string) string {
	r := strings.NewReplacer(".", "_", ":", "_")
	return r.Replace(name)
}

func tmuxSessionExists(name string) bool {
	cmd := exec.Command(tmuxPath, "has-session", "-t", name)
	return cmd.Run() == nil
}

func killTmuxSession(name string) {
	if !isTmuxAvailable() {
		return
	}
	safe := sanitizeTmuxName(name)
	cmd := exec.Command(tmuxPath, "kill-session", "-t", safe)
	_ = cmd.Run()
}

func captureTmuxPane(name string) string {
	if !isTmuxAvailable() {
		return ""
	}
	safe := sanitizeTmuxName(name)
	out, err := exec.Command(tmuxPath, "capture-pane", "-t", safe, "-p", "-e").Output()
	if err != nil {
		return ""
	}
	result := string(out)
	lines := strings.Split(result, "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\r\n") + "\r\n"
}

func startShell(sessionID string) *os.File {
	if isTmuxAvailable() && sessionID != "" {
		return startTmuxShell(sessionID)
	}
	return startRawShell()
}

func startTmuxShell(sessionID string) *os.File {
	safeName := sanitizeTmuxName(sessionID)

	var cmd *exec.Cmd
	if tmuxSessionExists(safeName) {
		log.Printf("[tmux] attaching to existing session %q", safeName)
		cmd = exec.Command(tmuxPath, "attach-session", "-t", safeName)
	} else {
		log.Printf("[tmux] creating new session %q", safeName)
		cmd = exec.Command(tmuxPath, "new-session", "-s", safeName)
	}

	cmd.SysProcAttr = &syscall.SysProcAttr{Setctty: true, Setsid: true}

	env := shellEnv()
	cmd.Env = env

	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = os.Getenv("HOME")
	}
	if homeDir != "" {
		cmd.Dir = homeDir
	}

	ptm, err := pty.Start(cmd)
	if err != nil {
		log.Printf("[tmux] failed to start tmux session: %v, falling back to raw shell", err)
		return startRawShell()
	}
	return ptm
}

func startRawShell() *os.File {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = os.Getenv("HOME")
	}

	cmd := exec.Command(shell)
	cmd.Env = shellEnv()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setctty: true, Setsid: true}
	if homeDir != "" {
		cmd.Dir = homeDir
	}

	ptm, err := pty.Start(cmd)
	if err != nil {
		log.Fatalf("failed to start shell: %v", err)
	}
	return ptm
}

func shellEnv() []string {
	env := os.Environ()
	hasTERM := false
	for _, e := range env {
		if len(e) >= 5 && e[:5] == "TERM=" {
			hasTERM = true
			break
		}
	}
	if !hasTERM {
		env = append(env, "TERM=xterm-256color")
	}
	return env
}
