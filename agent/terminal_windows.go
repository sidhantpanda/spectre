//go:build windows

package main

import (
	"log"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

func isTmuxAvailable() bool {
	return false
}

func killTmuxSession(_ string) {}

func captureTmuxPane(_ string) string { return "" }

func startShell(_ string) *os.File {
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
