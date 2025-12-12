package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"os/exec"
	"sync"
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

type ptySession struct {
	mu   sync.RWMutex
	ptm  *os.File
	stop chan struct{}
}

func newPtySession() *ptySession {
	return &ptySession{
		ptm:  nil,
		stop: make(chan struct{}),
	}
}

func (s *ptySession) current() *os.File {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ptm
}

func (s *ptySession) stopChan() <-chan struct{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stop
}

// reset starts a fresh shell, stops the current PTY reader, and returns the new PTY.
func (s *ptySession) reset() *os.File {
	s.mu.Lock()
	oldStop := s.stop
	old := s.ptm
	// replace stop channel so PTY reader can exit quietly
	s.stop = make(chan struct{})
	s.ptm = startShell()
	s.mu.Unlock()

	close(oldStop)
	if old != nil {
		_ = old.Close()
	}
	return s.ptm
}

func (s *ptySession) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
	if s.ptm != nil {
		_ = s.ptm.Close()
		s.ptm = nil
	}
}

func readFromControl(conn *websocket.Conn, session *ptySession, errCh chan<- error, restartPTY func(*os.File, <-chan struct{})) {
	for {
		var msg ControlMessage
		if err := conn.ReadJSON(&msg); err != nil {
			errCh <- err
			return
		}

		switch msg.Type {
		case "keystroke":
			ptm := session.current()
			if ptm == nil {
				errCh <- fmt.Errorf("no active pty (reset not requested yet)")
				return
			}
			if _, err := ptm.Write([]byte(msg.Data)); err != nil {
				errCh <- fmt.Errorf("write to pty failed: %w", err)
				return
			}
		case "reset":
			newPTY := session.reset()
			if newPTY != nil {
				restartPTY(newPTY, session.stopChan())
			}
		}
	}
}

func readFromPTY(conn *websocket.Conn, ptm *os.File, stop <-chan struct{}, errCh chan<- error) {
	reader := bufio.NewReader(ptm)
	buf := make([]byte, 2048)
	for {
		select {
		case <-stop:
			return
		default:
		}
		n, err := reader.Read(buf)
		if n > 0 {
			payload := AgentMessage{Type: "output", Data: string(buf[:n])}
			if err := conn.WriteJSON(payload); err != nil {
				errCh <- err
				return
			}
		}
		if err != nil {
			select {
			case <-stop:
				return
			default:
				errCh <- err
				return
			}
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
