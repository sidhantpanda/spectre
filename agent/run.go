package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func runAgent(host, authKey string) error {
	if host == "" {
		return fmt.Errorf("--host is required (e.g. --host wss://spectre.example.com)")
	}

	deviceInfo, err := ensureDeviceInfo()
	if err != nil {
		return fmt.Errorf("failed to load device id: %w", err)
	}

	instance := AgentInstanceInfo{
		PID:     os.Getpid(),
		AgentID: deviceInfo.DeviceID,
		Host:    host,
	}

	acquired, running, err := ensureSingleInstance(instance)
	if err != nil {
		return fmt.Errorf("failed to check agent instance: %w", err)
	}
	if !acquired && running != nil {
		return fmt.Errorf("spectre-agent is already running (pid %d)", running.PID)
	}
	defer func() {
		if err := releaseSingleton(instance.PID); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to release agent lock: %v\n", err)
		}
	}()

	fingerprint := collectFingerprint()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go connectToControlServer(host, authKey, &deviceInfo, fingerprint)

	<-ctx.Done()
	return nil
}
