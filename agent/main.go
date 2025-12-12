package main

import (
	"context"
	"flag"
	"log"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	listen := flag.String("listen", ":8081", "Address for the agent API and WebSocket server")
	token := flag.String("token", "changeme", "Auth token expected from the control server")
	flag.Parse()

	server := newAgentServer(*listen, *token)

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
