package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
)

type agentServer struct {
	addr        string
	token       string
	deviceID    string
	fingerprint map[string]any
	server      *http.Server
}

func newAgentServer(addr, token, deviceID string, fingerprint map[string]any) *agentServer {
	connectionURL := buildConnectionURL(addr)
	log.Printf("auth token: %s", token)
	log.Printf("connect control server using: %s", connectionURL)
	log.Printf("device id: %s", deviceID)

	mux := http.NewServeMux()
	s := &agentServer{
		addr:        addr,
		token:       token,
		deviceID:    deviceID,
		fingerprint: fingerprint,
		server: &http.Server{
			Addr:    addr,
			Handler: mux,
		},
	}

	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"agentId":     s.deviceID,
			"deviceId":    s.deviceID,
			"fingerprint": s.fingerprint,
		})
	})

	upgrader := websocket.Upgrader{CheckOrigin: func(_ *http.Request) bool { return true }}
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("failed to upgrade connection: %v", err)
			return
		}
		defer conn.Close()

		var hello ControlMessage
		if err := conn.ReadJSON(&hello); err != nil {
			log.Printf("failed to read handshake: %v", err)
			return
		}
		if hello.Type != "hello" || hello.Token != s.token {
			log.Printf("invalid handshake received")
			return
		}

		ack := AgentMessage{Type: "hello", AgentID: s.deviceID, Fingerprint: s.fingerprint}
		if err := conn.WriteJSON(ack); err != nil {
			log.Printf("failed to send handshake ack: %v", err)
			return
		}

		sessions := newPtyManager()
		errCh := make(chan error, 1)
		startPTY := func(session *ptySession) {
			go readFromPTY(conn, session, errCh)
		}
		go readFromControl(conn, sessions, errCh, startPTY)
		go sendHeartbeats(conn, errCh)

		if err := <-errCh; err != nil {
			log.Printf("connection closed: %v", err)
		}
		sessions.closeAll()
	})

	return s
}

func (s *agentServer) start() error {
	log.Printf("starting Spectre agent server on %s", s.addr)
	if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func (s *agentServer) shutdown(ctx context.Context) error {
	return s.server.Shutdown(ctx)
}
