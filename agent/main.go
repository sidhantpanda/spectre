package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	listen := flag.String("listen", ":8081", "Address for the agent API and WebSocket server")
	token := flag.String("token", "changeme", "Auth token expected from the control server")
	host := flag.String("host", "", "Optional control server host (ws://host:port/agents/register) to initiate a connection")
	flag.Parse()

	deviceInfo, err := ensureDeviceInfo()
	if err != nil {
		log.Fatalf("failed to load device id: %v", err)
	}

	fingerprint := collectFingerprint()
	agentID := deviceInfo.DeviceID
	connectionURL := buildConnectionURL(*listen)

	instance := AgentInstanceInfo{
		PID:           os.Getpid(),
		AgentID:       agentID,
		Listen:        *listen,
		ConnectionURL: connectionURL,
		Host:          *host,
		Token:         *token,
	}

	acquired, running, err := ensureSingleInstance(instance)
	if err != nil {
		log.Fatalf("failed to check agent instance: %v", err)
	}
	if !acquired && running != nil {
		log.Printf("spectre-agent already running (pid %d)", running.PID)
		log.Printf("agent id: %s", running.AgentID)
		log.Printf("control server can connect via: %s", running.ConnectionURL)
		return
	}
	defer func() {
		if err := releaseSingleton(instance.PID); err != nil {
			log.Printf("warning: failed to release agent lock: %v", err)
		}
	}()

	server := newAgentServer(*listen, *token, agentID, fingerprint)

	if *host != "" {
		go connectToControlServer(*host, *token, agentID, fingerprint)
	}

	go func() {
		if err := server.start(); err != nil {
			log.Fatalf("failed to start server: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}
}
