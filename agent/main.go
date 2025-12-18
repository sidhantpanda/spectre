package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
)

func main() {
	root := newRootCommand()
	root.SilenceErrors = true
	root.SilenceUsage = true

	if err := root.Execute(); err != nil {
		handleCommandError(root, err)
		os.Exit(1)
	}
}

func newRootCommand() *cobra.Command {
	var listen, token, host string
	cmd := &cobra.Command{
		Use:          "spectre-agent",
		Short:        "Run the Spectre agent server",
		Long:         "Starts the Spectre agent API and WebSocket server for remote control connections.",
		Example:      "spectre-agent --listen :8081 --token changeme --host ws://host:8080/agents/register",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return runAgent(listen, token, host)
		},
	}

	cmd.Flags().StringVar(&listen, "listen", ":8081", "Address for the agent API and WebSocket server")
	cmd.Flags().StringVar(&token, "token", "changeme", "Auth token expected from the control server")
	cmd.Flags().StringVar(&host, "host", "", "Optional control server host (ws://host:port/agents/register) to initiate a connection")

	cmd.AddCommand(newUpCommand(), newDownCommand())
	return cmd
}

func newUpCommand() *cobra.Command {
	var listen, token, host string
	cmd := &cobra.Command{
		Use:          "up",
		Short:        "Install and start spectre-agent as a service",
		Long:         "Installs spectre-agent as a system service (systemd or launchd) and starts it with the provided flags.",
		Example:      "spectre-agent up --listen :8081 --token changeme --host ws://host:8080/agents/register",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return serviceUp(listen, token, host)
		},
	}

	cmd.Flags().StringVar(&listen, "listen", ":8081", "Address for the agent API and WebSocket server")
	cmd.Flags().StringVar(&token, "token", "changeme", "Auth token expected from the control server")
	cmd.Flags().StringVar(&host, "host", "", "Optional control server host (ws://host:port/agents/register) to initiate a connection")

	return cmd
}

func newDownCommand() *cobra.Command {
	return &cobra.Command{
		Use:          "down",
		Short:        "Stop and remove the spectre-agent service",
		Long:         "Stops the spectre-agent service and removes it from the system service configuration.",
		Example:      "spectre-agent down",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return serviceDown()
		},
	}
}

func handleCommandError(cmd *cobra.Command, err error) {
	cmd.PrintErrf("Error: %v\n", err)

	if strings.HasPrefix(err.Error(), "unknown command") {
		cmd.PrintErrln("\nAvailable commands:")
		for _, c := range cmd.Commands() {
			if c.Hidden {
				continue
			}
			cmd.PrintErrf("  %-10s %s\n", c.Name(), c.Short)
		}
		cmd.PrintErrf("\nRun '%s --help' for usage.\n", cmd.CommandPath())
		return
	}

	cmd.PrintErrf("Run '%s --help' for usage.\n", cmd.CommandPath())
}

func runAgent(listen, token, host string) error {
	deviceInfo, err := ensureDeviceInfo()
	if err != nil {
		return fmt.Errorf("failed to load device id: %w", err)
	}

	fingerprint := collectFingerprint()
	agentID := deviceInfo.DeviceID
	connectionURL := buildConnectionURL(listen)

	instance := AgentInstanceInfo{
		PID:           os.Getpid(),
		AgentID:       agentID,
		Listen:        listen,
		ConnectionURL: connectionURL,
		Host:          host,
		Token:         token,
	}

	acquired, running, err := ensureSingleInstance(instance)
	if err != nil {
		return fmt.Errorf("failed to check agent instance: %w", err)
	}
	if !acquired && running != nil {
		log.Printf("spectre-agent already running (pid %d)", running.PID)
		log.Printf("agent id: %s", running.AgentID)
		log.Printf("control server can connect via: %s", running.ConnectionURL)
		return nil
	}
	defer func() {
		if err := releaseSingleton(instance.PID); err != nil {
			log.Printf("warning: failed to release agent lock: %v", err)
		}
	}()

	server := newAgentServer(listen, token, agentID, fingerprint)

	if host != "" {
		go connectToControlServer(host, token, agentID, fingerprint)
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.start()
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("server shutdown error: %w", err)
	}

	if err := <-errCh; err != nil {
		return fmt.Errorf("server error: %w", err)
	}
	return nil
}
