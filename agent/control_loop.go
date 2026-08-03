package main

import (
	"bufio"
	"fmt"
	"log"
	"time"
)

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
			session, created := sessions.reset(sessionID, msg.Cols, msg.Rows)
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
		case "resize":
			if sessionID == "" {
				continue
			}
			session := sessions.get(sessionID)
			if session == nil {
				log.Printf("ignoring resize for unknown session %s", sessionID)
				continue
			}
			session.resize(msg.Cols, msg.Rows)
		case "attachSession", "reset":
			if sessionID == "" {
				log.Printf("ignoring attach with no session id")
				continue
			}
			session, created := sessions.reset(sessionID, msg.Cols, msg.Rows)
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
		case "update":
			handleRemoteUpdate(conn, msg.Version)
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
