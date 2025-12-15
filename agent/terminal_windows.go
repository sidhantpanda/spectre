//go:build windows

package main

import (
	"log"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

func startShell() *os.File {
	shell := os.Getenv("COMSPEC")
	if shell == "" {
		shell = "cmd.exe"
	}

	cmd := exec.Command(shell)
	cmd.Env = os.Environ()

	ptm, err := pty.Start(cmd)
	if err != nil {
		log.Fatalf("failed to start shell: %v", err)
	}
	return ptm
}
