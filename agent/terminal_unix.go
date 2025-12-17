//go:build !windows

package main

import (
	"log"
	"os"
	"os/exec"
	"syscall"

	"github.com/creack/pty"
)

func startShell() *os.File {
	c := &syscall.SysProcAttr{Setctty: true, Setsid: true}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

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

	cmd := exec.Command(shell)
	cmd.Env = env
	cmd.SysProcAttr = c

	ptm, err := pty.Start(cmd)
	if err != nil {
		log.Fatalf("failed to start shell: %v", err)
	}
	return ptm
}
