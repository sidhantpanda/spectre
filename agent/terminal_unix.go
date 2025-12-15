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

	cmd := exec.Command(shell)
	cmd.Env = os.Environ()
	cmd.SysProcAttr = c

	ptm, err := pty.Start(cmd)
	if err != nil {
		log.Fatalf("failed to start shell: %v", err)
	}
	return ptm
}
