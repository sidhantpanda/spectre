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

// safeConn wraps a websocket.Conn with a mutex to prevent concurrent writes.
// gorilla/websocket does not support concurrent writers.
type safeConn struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func newSafeConn(conn *websocket.Conn) *safeConn {
	return &safeConn{conn: conn}
}

func (c *safeConn) writeJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(v)
}

func (c *safeConn) readJSON(v interface{}) error {
	return c.conn.ReadJSON(v)
}

func (c *safeConn) close() error {
	return c.conn.Close()
}

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

// reset attaches to an existing tmux session (if available) or starts a fresh
// shell. Stops the current PTY reader and replaces the master FD.
func (s *ptySession) reset() *os.File {
	s.mu.Lock()
	oldStop := s.stop
	old := s.ptm
	s.stop = make(chan struct{})
	s.ptm = startShell(s.sessionID)
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

func (m *ptyManager) reset(sessionID string) (*ptySession, bool) {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	if !ok {
		session = newPtySession(sessionID)
		m.sessions[sessionID] = session
	}
	alreadyRunning := ok && session.current() != nil
	m.mu.Unlock()

	if alreadyRunning {
		return session, false
	}
	session.reset()
	return session, true
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
	killTmuxSession(s.sessionID)
}

// finish is called when the shell exits on its own (for example, the user
// pressed Ctrl+D). It marks the session inactive so keystrokes are ignored and
// a later reset starts a fresh shell, without closing the stop channel — reset
// closes it, and closing it twice would panic.
func (s *ptySession) finish() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ptm != nil {
		_ = s.ptm.Close()
		s.ptm = nil
	}
	killTmuxSession(s.sessionID)
}

func (m *ptyManager) activeSessions() []*ptySession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*ptySession, 0, len(m.sessions))
	for _, s := range m.sessions {
		if s.current() != nil {
			result = append(result, s)
		}
	}
	return result
}

func readFromControl(conn *safeConn, sessions *ptyManager, errCh chan<- error, restartPTY func(*ptySession)) {
	for {
		var msg ControlMessage
		if err := conn.readJSON(&msg); err != nil {
			errCh <- err
			return
		}

		sessionID := msg.SessionID
		if sessionID == "" {
			sessionID = "spectre"
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
			session, created := sessions.reset(sessionID)
			if created {
				restartPTY(session)
			} else {
				content := captureTmuxPane(sessionID)
				if content != "" {
					if err := conn.writeJSON(AgentMessage{Type: "output", Data: content, SessionID: sessionID}); err != nil {
						errCh <- err
						return
					}
				}
				ptm := session.current()
				if ptm != nil {
					_, _ = ptm.Write([]byte{0x0c}) // Ctrl+L: redraw the terminal
				}
			}
		case "dockerInfo":
			containers, err := listDockerContainers()
			payload := AgentMessage{
				Type:       "dockerInfo",
				Containers: containers,
			}
			if err != nil {
				payload.Error = err.Error()
			}
			if err := conn.writeJSON(payload); err != nil {
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
			if err := conn.writeJSON(payload); err != nil {
				errCh <- err
				return
			}
		case "networkInfo":
			info := collectNetworkInfo()
			payload := AgentMessage{
				Type:        "networkInfo",
				NetworkInfo: &info,
			}
			if err := conn.writeJSON(payload); err != nil {
				errCh <- err
				return
			}
		}
	}
}

func readFromPTY(conn *safeConn, session *ptySession, errCh chan<- error) {
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
			if err := conn.writeJSON(payload); err != nil {
				errCh <- err
				return
			}
		}
		if err != nil {
			select {
			case <-session.stopChan():
				// The session was deliberately replaced (reset) or torn down.
				return
			default:
			}
			// The shell exited on its own — most often the user pressed Ctrl+D.
			// End only this terminal session; the control connection must stay
			// up so the agent remains reachable and a fresh shell can start on
			// the next reset. Pushing this onto errCh would drop the whole
			// connection and make the agent appear to disconnect.
			session.finish()
			_ = conn.writeJSON(AgentMessage{
				Type:      "output",
				Data:      "\r\n\x1b[90m[session ended — reload to start a new shell]\x1b[0m\r\n",
				SessionID: session.sessionID,
			})
			return
		}
	}
}

func sendHeartbeats(conn *safeConn, errCh chan<- error) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for range ticker.C {
		if err := conn.writeJSON(AgentMessage{Type: "heartbeat"}); err != nil {
			errCh <- err
			return
		}
	}
}
