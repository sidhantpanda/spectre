package main

import (
	"log"

	"github.com/gorilla/websocket"
)

// connectToControlServer dials the control server (when provided via CLI flag)
// and establishes the same shell bridge used for inbound connections.
func connectToControlServer(host, token string) {
	wsURL, err := buildControlServerURL(host, token)
	if err != nil {
		log.Printf("invalid control server host %q: %v", host, err)
		return
	}

	fingerprint := collectFingerprint()
	agentID := fingerprint["fingerprint"].(string)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Printf("failed to connect to control server at %s: %v", wsURL, err)
		return
	}
	defer conn.Close()

	log.Printf("connected to control server via %s", wsURL)

	hello := AgentMessage{Type: "hello", AgentID: agentID, Fingerprint: fingerprint}
	if err := conn.WriteJSON(hello); err != nil {
		log.Printf("failed to send handshake to control server: %v", err)
		return
	}

	var ack ControlMessage
	if err := conn.ReadJSON(&ack); err != nil {
		log.Printf("failed to read control server ack: %v", err)
		return
	}
	if ack.Type != "hello" {
		log.Printf("unexpected handshake response from control server: %v", ack.Type)
		return
	}

	shell := startShell()
	defer shell.Close()

	errCh := make(chan error, 1)
	go readFromControl(conn, shell, errCh)
	go readFromPTY(conn, shell, errCh)
	go sendHeartbeats(conn, errCh)

	if err := <-errCh; err != nil {
		log.Printf("control server connection closed: %v", err)
	}
}
