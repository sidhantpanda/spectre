package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
)

type agentServer struct {
	addr   string
	token  string
	server *http.Server
}

func newAgentServer(addr, token string) *agentServer {
	fingerprint := collectFingerprint()
	agentID := fingerprint["fingerprint"].(string)

	connectionURL := buildConnectionURL(addr)
	log.Printf("auth token: %s", token)
	log.Printf("connect control server using: %s", connectionURL)

	mux := http.NewServeMux()
	s := &agentServer{
		addr:  addr,
		token: token,
		server: &http.Server{
			Addr:    addr,
			Handler: mux,
		},
	}

	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"agentId":     agentID,
			"fingerprint": fingerprint,
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

		shell := startShell()
		defer shell.Close()

		ack := AgentMessage{Type: "hello", AgentID: agentID, Fingerprint: fingerprint}
		if err := conn.WriteJSON(ack); err != nil {
			log.Printf("failed to send handshake ack: %v", err)
			return
		}

		errCh := make(chan error, 1)
		go readFromControl(conn, shell, errCh)
		go readFromPTY(conn, shell, errCh)
		go sendHeartbeats(conn, errCh)

		if err := <-errCh; err != nil {
			log.Printf("connection closed: %v", err)
		}
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
