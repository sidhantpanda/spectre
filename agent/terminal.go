package main

import (
	"bufio"
	"crypto/rand"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Sessions the agent creates are named "spectre-<uuid>". The bare "spectre"
// name is what single-session agents used before multi-session support; it is
// still recognised so an upgraded agent adopts the old session instead of
// stranding it.
const (
	spectreSessionPrefix = "spectre-"
	legacySessionName    = "spectre"
)

func isManagedSessionName(name string) bool {
	return name == legacySessionName || strings.HasPrefix(name, spectreSessionPrefix)
}

// tmuxListFormat is the -F template parseTmuxSessions expects.
const tmuxListFormat = "#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}"

// parseTmuxSessions turns `tmux list-sessions -F tmuxListFormat` output into
// session records. Kept separate from the exec call so it can be tested on
// machines without tmux installed.
func parseTmuxSessions(out string) []SessionInfo {
	var sessions []SessionInfo
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 4 {
			continue
		}
		created, _ := strconv.ParseInt(parts[1], 10, 64)
		windows, _ := strconv.Atoi(parts[3])
		sessions = append(sessions, SessionInfo{
			ID:        parts[0],
			CreatedAt: created,
			Attached:  parts[2] != "0",
			Windows:   windows,
			Managed:   isManagedSessionName(parts[0]),
		})
	}
	return sessions
}

// newSessionID mints a "spectre-<uuid>" name. The agent has no uuid dependency,
// so this formats random bytes as a v4 UUID rather than pulling one in.
func newSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%s%d", spectreSessionPrefix, time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s%x-%x-%x-%x-%x", spectreSessionPrefix, b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

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

// finish is called when the PTY reaches EOF: the shell exited, or the tmux
// client detached. It marks the session inactive so keystrokes are ignored and
// a later attach starts a fresh shell, without closing the stop channel — reset
// closes it, and closing it twice would panic.
//
// It deliberately does not kill the tmux session. EOF here does not mean the
// session is finished: detaching (Ctrl+B d) ends this client while the session
// keeps running, and a session with other windows open survives one shell
// exiting. Killing on EOF would destroy exactly the sessions the user meant to
// leave running. Sessions are only ever torn down on an explicit killSession.
func (s *ptySession) finish() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ptm != nil {
		_ = s.ptm.Close()
		s.ptm = nil
	}
}

// remove drops a session from the map after it has been killed, so it stops
// appearing in the inventory.
func (m *ptyManager) remove(sessionID string) *ptySession {
	m.mu.Lock()
	defer m.mu.Unlock()
	session := m.sessions[sessionID]
	delete(m.sessions, sessionID)
	return session
}

// inventory reports what the user can attach to: every tmux session on the
// host, plus any live in-memory session this agent holds that tmux does not
// know about (the raw-shell fallback on hosts without tmux).
func (m *ptyManager) inventory() []SessionInfo {
	sessions := listTmuxSessions()

	live := make(map[string]bool)
	m.mu.RLock()
	for id, s := range m.sessions {
		if s.current() != nil {
			live[id] = true
		}
	}
	m.mu.RUnlock()

	seen := make(map[string]bool, len(sessions))
	for i := range sessions {
		seen[sessions[i].ID] = true
		sessions[i].Live = live[sessions[i].ID]
	}

	// Raw shells exist only here; without tmux they are the whole inventory.
	for id := range live {
		if !seen[id] {
			sessions = append(sessions, SessionInfo{
				ID:      id,
				Managed: isManagedSessionName(id),
				Live:    true,
			})
		}
	}
	return sessions
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

func sendSessions(conn *safeConn, sessions *ptyManager) error {
	return conn.writeJSON(AgentMessage{
		Type:          "sessions",
		Sessions:      sessions.inventory(),
		TmuxAvailable: isTmuxAvailable(),
	})
}

func readFromControl(conn *safeConn, sessions *ptyManager, errCh chan<- error, restartPTY func(*ptySession)) {
	for {
		var msg ControlMessage
		if err := conn.readJSON(&msg); err != nil {
			errCh <- err
			return
		}

		sessionID := msg.SessionID

		switch msg.Type {
		case "keystroke":
			if sessionID == "" {
				log.Printf("ignoring keystroke with no session id")
				continue
			}
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
		case "listSessions":
			if err := sendSessions(conn, sessions); err != nil {
				errCh <- err
				return
			}
		case "createSession":
			// The server normally mints the name so it can tell the UI which
			// session it just opened; falling back keeps the agent usable on
			// its own.
			if sessionID == "" {
				sessionID = newSessionID()
			}
			session, created := sessions.reset(sessionID)
			if created {
				restartPTY(session)
			}
			if err := conn.writeJSON(AgentMessage{Type: "sessionOpened", SessionID: sessionID}); err != nil {
				errCh <- err
				return
			}
			if err := sendSessions(conn, sessions); err != nil {
				errCh <- err
				return
			}
		case "killSession":
			if sessionID == "" {
				continue
			}
			if session := sessions.remove(sessionID); session != nil {
				session.close() // closes the PTY and kills the tmux session
			} else {
				// Not attached in this process — it is a session that outlived
				// an agent restart, or one the user started themselves.
				killTmuxSession(sessionID)
			}
			if err := conn.writeJSON(AgentMessage{Type: "sessionClosed", SessionID: sessionID}); err != nil {
				errCh <- err
				return
			}
			if err := sendSessions(conn, sessions); err != nil {
				errCh <- err
				return
			}
		// "reset" is what pre-multi-session servers send; it means the same
		// thing as attachSession, so both are handled here.
		case "attachSession", "reset":
			if sessionID == "" {
				log.Printf("ignoring attach with no session id")
				continue
			}
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

func readFromPTY(conn *safeConn, session *ptySession, sessions *ptyManager, errCh chan<- error) {
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
			// The PTY ended: the shell exited, or the tmux client detached.
			// End only this terminal session; the control connection must stay
			// up so the agent remains reachable and a fresh shell can start on
			// the next attach. Pushing this onto errCh would drop the whole
			// connection and make the agent appear to disconnect.
			//
			// The tmux session itself is left alone — see ptySession.finish.
			session.finish()
			_ = conn.writeJSON(AgentMessage{
				Type:      "sessionExited",
				SessionID: session.sessionID,
			})
			_ = sendSessions(conn, sessions)
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
