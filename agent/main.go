package main

import (
	"bufio"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const heartbeatInterval = 25 * time.Second

// ControlMessage documents what the agent can receive from the control server.
type ControlMessage struct {
	Type  string `json:"type"`
	Token string `json:"token,omitempty"`
	Data  string `json:"data,omitempty"`
}

// AgentMessage documents what the agent sends to the control server.
type AgentMessage struct {
	Type        string         `json:"type"`
	AgentID     string         `json:"agentId,omitempty"`
	Fingerprint map[string]any `json:"fingerprint,omitempty"`
	Data        string         `json:"data,omitempty"`
}

func main() {
	listen := flag.String("listen", ":8081", "Address for the agent API and WebSocket server")
	token := flag.String("token", "changeme", "Auth token expected from the control server")
	flag.Parse()

	fingerprint := collectFingerprint()
	agentID := fingerprint["fingerprint"].(string)

	connectionURL := buildConnectionURL(*listen)
	log.Printf("auth token: %s", *token)
	log.Printf("connect control server using: %s", connectionURL)

	mux := http.NewServeMux()

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
		if hello.Type != "hello" || hello.Token != *token {
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

	server := &http.Server{
		Addr:    *listen,
		Handler: mux,
	}

	go func() {
		log.Printf("starting Spectre agent server on %s", *listen)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("failed to start server: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}
}

func startShell() *os.File {
	c := &syscall.SysProcAttr{Setctty: true, Setsid: true}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmd := exec.Command(shell)
	cmd.Env = os.Environ()
	cmd.SysProcAttr = c

	ptm, err := pty.Start(cmd)
	if err != nil {
		log.Fatalf("failed to start shell: %v", err)
	}
	return ptm
}

func readFromControl(conn *websocket.Conn, ptm *os.File, errCh chan<- error) {
	for {
		var msg ControlMessage
		if err := conn.ReadJSON(&msg); err != nil {
			errCh <- err
			return
		}

		switch msg.Type {
		case "keystroke":
			if _, err := ptm.Write([]byte(msg.Data)); err != nil {
				errCh <- fmt.Errorf("write to pty failed: %w", err)
				return
			}
		}
	}
}

func readFromPTY(conn *websocket.Conn, ptm *os.File, errCh chan<- error) {
	reader := bufio.NewReader(ptm)
	buf := make([]byte, 2048)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			payload := AgentMessage{Type: "output", Data: string(buf[:n])}
			if err := conn.WriteJSON(payload); err != nil {
				errCh <- err
				return
			}
		}
		if err != nil {
			errCh <- err
			return
		}
	}
}

func sendHeartbeats(conn *websocket.Conn, errCh chan<- error) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for range ticker.C {
		if err := conn.WriteJSON(AgentMessage{Type: "heartbeat"}); err != nil {
			errCh <- err
			return
		}
	}
}

func collectFingerprint() map[string]any {
	hostname, _ := os.Hostname()
	machineID := readFileTrim("/etc/machine-id")
	macs, nics := listInterfaces()

	h := sha1.New()
	h.Write([]byte(hostname))
	h.Write([]byte(machineID))
	h.Write([]byte(strings.Join(macs, ",")))
	h.Write([]byte(strings.Join(nics, ",")))
	hash := hex.EncodeToString(h.Sum(nil))

	return map[string]any{
		"hostname":     hostname,
		"machineId":    machineID,
		"macAddresses": macs,
		"nics":         nics,
		"fingerprint":  hash,
	}
}

func readFileTrim(path string) string {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(bytes))
}

func listInterfaces() ([]string, []string) {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil, nil
	}
	macs := []string{}
	nics := []string{}
	for _, iface := range ifs {
		nics = append(nics, iface.Name)
		if len(iface.HardwareAddr) > 0 {
			macs = append(macs, iface.HardwareAddr.String())
		}
	}
	return macs, nics
}

// buildConnectionURL returns a usable WebSocket URL for the control server to dial.
func buildConnectionURL(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return fmt.Sprintf("ws://%s/ws", strings.TrimPrefix(listen, ":"))
	}

	if host == "" || host == "0.0.0.0" || host == "::" {
		if ip := guessLocalIPv4(); ip != "" {
			host = ip
		} else {
			host = "localhost"
		}
	}
	return fmt.Sprintf("ws://%s:%s/ws", host, port)
}

func guessLocalIPv4() string {
	ifs, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifs {
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok {
				ip := ipnet.IP.To4()
				if ip != nil && !ip.IsLoopback() {
					return ip.String()
				}
			}
		}
	}
	return ""
}
