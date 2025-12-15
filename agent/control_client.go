package main

import (
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// connectToControlServer dials the control server (when provided via CLI flag)
// and establishes the same shell bridge used for inbound connections.
func connectToControlServer(host, token, deviceID string, fingerprint map[string]any) {

	backoff := time.Second
	for {
		wsURL, err := buildControlServerURL(host, token)
		if err != nil {
			log.Printf("invalid control server host %q: %v", host, err)
			return
		}

		conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			var details string
			if resp != nil {
				body, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				trimmed := strings.TrimSpace(string(body))
				if trimmed != "" {
					details = fmt.Sprintf(" (HTTP %s: %s)", resp.Status, trimmed)
				} else {
					details = fmt.Sprintf(" (HTTP %s)", resp.Status)
				}
			}
			log.Printf("failed to connect to control server at %s: %v%s", wsURL, err, details)
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}

		log.Printf("connected to control server via %s", wsURL)

		hello := AgentMessage{Type: "hello", AgentID: deviceID, Fingerprint: fingerprint}
		if err := conn.WriteJSON(hello); err != nil {
			log.Printf("failed to send handshake to control server: %v", err)
			conn.Close()
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}

		var ack ControlMessage
		if err := conn.ReadJSON(&ack); err != nil {
			log.Printf("failed to read control server ack: %v", err)
			conn.Close()
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}
		if ack.Type != "hello" {
			log.Printf("unexpected handshake response from control server: %v", ack.Type)
			conn.Close()
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}

		sessions := newPtyManager()
		errCh := make(chan error, 1)
		startPTY := func(session *ptySession) {
			go readFromPTY(conn, session, errCh)
		}
		// Ensure there is always a default session available when the control server
		// does not send an explicit session identifier (e.g., legacy clients).
		sessions.reset("default")
		go readFromControl(conn, sessions, errCh, startPTY)
		go sendHeartbeats(conn, errCh)

		if err := <-errCh; err != nil {
			log.Printf("control server connection closed: %v", err)
		}
		sessions.closeAll()
		conn.Close()

		backoff = nextBackoff(backoff)
		time.Sleep(backoff)
	}
}

func nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > 30*time.Second {
		return 30 * time.Second
	}
	return next
}
