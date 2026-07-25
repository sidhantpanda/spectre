package main

import "sync"

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

// reset returns the session for sessionID, starting a shell if it has none.
// cols and rows are the requesting viewer's geometry; they are applied before
// the shell starts so it is never laid out at the wrong size.
func (m *ptyManager) reset(sessionID string, cols, rows uint16) (*ptySession, bool) {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	if !ok {
		session = newPtySession(sessionID)
		m.sessions[sessionID] = session
	}
	alreadyRunning := ok && session.current() != nil
	m.mu.Unlock()

	// Applies to the live PTY when one exists, and is remembered for the shell
	// started just below when one does not.
	session.resize(cols, rows)

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
