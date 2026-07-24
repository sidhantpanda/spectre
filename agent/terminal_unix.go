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

// listTmuxSessions reports every tmux session on the host, not just the ones
// Spectre started. Sessions outlive the agent process, so this — not the
// in-memory session map — is the source of truth for what can be attached to:
// after an agent restart the map is empty while the sessions are all still
// there.
//
// tmux exits non-zero when no server is running, which is not an error worth
// reporting; it just means there are no sessions.
func listTmuxSessions() []SessionInfo {
	if !isTmuxAvailable() {
		return nil
	}
	out, err := exec.Command(tmuxPath, "list-sessions", "-F", tmuxListFormat).Output()
	if err != nil {
		return nil
	}
	return parseTmuxSessions(string(out))
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

// setPtySize pushes a new window size onto the PTY master, which makes the
// kernel deliver SIGWINCH to the foreground process group. For a tmux client
// this also resizes the session's windows to match.
func setPtySize(ptm *os.File, cols, rows uint16) {
	if ptm == nil || cols == 0 || rows == 0 {
		return
	}
	if err := pty.Setsize(ptm, &pty.Winsize{Cols: cols, Rows: rows}); err != nil {
		log.Printf("[pty] resize to %dx%d failed: %v", cols, rows, err)
	}
}

func startShell(sessionID string, cols, rows uint16) *os.File {
	if isTmuxAvailable() && sessionID != "" {
		return startTmuxShell(sessionID, cols, rows)
	}
	return startRawShell(cols, rows)
}

func startTmuxShell(sessionID string, cols, rows uint16) *os.File {
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

	// Opening the PTY at the browser's size means tmux lays the session out
	// correctly from the first frame, instead of drawing at a default geometry
	// and reflowing once the first resize arrives.
	ptm, err := pty.StartWithAttrs(cmd, winsize(cols, rows), cmd.SysProcAttr)
	if err != nil {
		log.Printf("[tmux] failed to start tmux session: %v, falling back to raw shell", err)
		return startRawShell(cols, rows)
	}
	return ptm
}

// winsize builds a Winsize, substituting a conventional 80x24 when the caller
// has no size yet, so a PTY is never opened at 0x0.
func winsize(cols, rows uint16) *pty.Winsize {
	if cols == 0 {
		cols = defaultCols
	}
	if rows == 0 {
		rows = defaultRows
	}
	return &pty.Winsize{Cols: cols, Rows: rows}
}

func startRawShell(cols, rows uint16) *os.File {
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

	ptm, err := pty.StartWithAttrs(cmd, winsize(cols, rows), cmd.SysProcAttr)
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
