package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type ptySession struct {
	mu        sync.RWMutex
	ptm       *os.File
	stop      chan struct{}
	sessionID string
}

func newPtySession(sessionID string) *ptySession {
	return &ptySession{
		ptm:       nil,
		stop:      make(chan struct{}),
		sessionID: sessionID,
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

type ptyManager struct {
	mu       sync.RWMutex
	sessions map[string]*ptySession
}

func newPtyManager() *ptyManager {
	return &ptyManager{sessions: make(map[string]*ptySession)}
}

func (m *ptyManager) get(sessionID string) *ptySession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[sessionID]
}

func (m *ptyManager) reset(sessionID string) *ptySession {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	if !ok {
		session = newPtySession(sessionID)
		m.sessions[sessionID] = session
	}
	m.mu.Unlock()

	session.reset()
	return session
}

func (m *ptyManager) closeAll() {
	m.mu.RLock()
	sessions := make([]*ptySession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.RUnlock()

	for _, session := range sessions {
		session.close()
	}
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

func readFromControl(conn *websocket.Conn, sessions *ptyManager, errCh chan<- error, restartPTY func(*ptySession)) {
	for {
		var msg ControlMessage
		if err := conn.ReadJSON(&msg); err != nil {
			errCh <- err
			return
		}

		sessionID := msg.SessionID
		if sessionID == "" {
			sessionID = "default"
		}

		switch msg.Type {
		case "keystroke":
			session := sessions.get(sessionID)
			if session == nil {
				log.Printf("ignoring keystroke for unknown session %s", sessionID)
				continue
			}
			ptm := session.current()
			if ptm == nil {
				log.Printf("ignoring keystroke for inactive session %s", sessionID)
				continue
			}
			if _, err := ptm.Write([]byte(msg.Data)); err != nil {
				errCh <- fmt.Errorf("write to pty failed: %w", err)
				return
			}
		case "reset":
			session := sessions.reset(sessionID)
			restartPTY(session)
		case "dockerInfo":
			containers, err := listDockerContainers()
			payload := AgentMessage{
				Type:       "dockerInfo",
				Containers: containers,
			}
			if err != nil {
				payload.Error = err.Error()
			}
			if err := conn.WriteJSON(payload); err != nil {
				errCh <- err
				return
			}
		case "systemInfo":
			info, err := collectSystemInfo()
			payload := AgentMessage{
				Type:       "systemInfo",
				SystemInfo: &info,
			}
			if err != nil {
				payload.Error = err.Error()
			}
			if err := conn.WriteJSON(payload); err != nil {
				errCh <- err
				return
			}
		}
	}
}

func readFromPTY(conn *websocket.Conn, session *ptySession, errCh chan<- error) {
	ptm := session.current()
	reader := bufio.NewReader(ptm)
	buf := make([]byte, 2048)
	for {
		select {
		case <-session.stopChan():
			return
		default:
		}
		n, err := reader.Read(buf)
		if n > 0 {
			payload := AgentMessage{Type: "output", Data: string(buf[:n]), SessionID: session.sessionID}
			if err := conn.WriteJSON(payload); err != nil {
				errCh <- err
				return
			}
		}
		if err != nil {
			select {
			case <-session.stopChan():
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
