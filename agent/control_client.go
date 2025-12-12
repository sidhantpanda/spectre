package main

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

// connectToControlServer dials the control server (when provided via CLI flag)
// and establishes the same shell bridge used for inbound connections.
func connectToControlServer(host, token string) {
	fingerprint := collectFingerprint()
	agentID := fingerprint["fingerprint"].(string)

	backoff := time.Second
	for {
		wsURL, err := buildControlServerURL(host, token)
		if err != nil {
			log.Printf("invalid control server host %q: %v", host, err)
			return
		}

		conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			log.Printf("failed to connect to control server at %s: %v", wsURL, err)
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}

		log.Printf("connected to control server via %s", wsURL)

		hello := AgentMessage{Type: "hello", AgentID: agentID, Fingerprint: fingerprint}
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

		shell := startShell()

		errCh := make(chan error, 1)
		go readFromControl(conn, shell, errCh)
		go readFromPTY(conn, shell, errCh)
		go sendHeartbeats(conn, errCh)

		if err := <-errCh; err != nil {
			log.Printf("control server connection closed: %v", err)
		}
		shell.Close()
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
