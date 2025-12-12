package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
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

func readFromControl(conn *websocket.Conn, ptm *os.File, errCh chan<- error) {
	for {
		var msg ControlMessage
		if err := conn.ReadJSON(&msg); err != nil {
			errCh <- err
			return
		}

		switch msg.Type {
		case "keystroke":
			if _, err := ptm.Write([]byte(msg.Data)); err != nil {
				errCh <- fmt.Errorf("write to pty failed: %w", err)
				return
			}
		}
	}
}

func readFromPTY(conn *websocket.Conn, ptm *os.File, errCh chan<- error) {
	reader := bufio.NewReader(ptm)
	buf := make([]byte, 2048)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			payload := AgentMessage{Type: "output", Data: string(buf[:n])}
			if err := conn.WriteJSON(payload); err != nil {
				errCh <- err
				return
			}
		}
		if err != nil {
			errCh <- err
			return
		}
	}
}

func sendHeartbeats(conn *websocket.Conn, errCh chan<- error) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for range ticker.C {
		if err := conn.WriteJSON(AgentMessage{Type: "heartbeat"}); err != nil {
			errCh <- err
			return
		}
	}
}
