package main

import (
	"os"
	"sync"
)

// Conventional terminal size, used until the browser reports its own.
const (
	defaultCols uint16 = 80
	defaultRows uint16 = 24
)

type ptySession struct {
	mu        sync.RWMutex
	ptm       *os.File
	stop      chan struct{}
	sessionID string
	// cols and rows track the viewer's geometry. They are remembered on the
	// session so a reconnect re-opens the PTY at the right size rather than
	// dropping back to the default until the next resize arrives.
	cols uint16
	rows uint16
}

func newPtySession(sessionID string) *ptySession {
	return &ptySession{
		ptm:       nil,
		stop:      make(chan struct{}),
		sessionID: sessionID,
		cols:      defaultCols,
		rows:      defaultRows,
	}
}

// resize records a new geometry and applies it to the live PTY, if there is one.
func (s *ptySession) resize(cols, rows uint16) {
	if cols == 0 || rows == 0 {
		return
	}
	s.mu.Lock()
	s.cols, s.rows = cols, rows
	ptm := s.ptm
	s.mu.Unlock()

	setPtySize(ptm, cols, rows)
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
	s.ptm = startShell(s.sessionID, s.cols, s.rows)
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
