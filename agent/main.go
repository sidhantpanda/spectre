package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
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
	var listen, token, host, enroll string
	cmd := &cobra.Command{
		Use:          "spectre-agent",
		Short:        "Run the Spectre agent server",
		Long:         "Starts the Spectre agent API and WebSocket server for remote control connections.",
		Example:      "spectre-agent --listen :8081 --host ws://host:8080 --enroll <token>",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return runAgent(listen, token, host, enroll)
		},
	}

	cmd.Flags().StringVar(&listen, "listen", ":8081", "Address for the agent API and WebSocket server")
	cmd.Flags().StringVar(&token, "token", "changeme", "Auth token for outbound connections from the control server")
	cmd.Flags().StringVar(&host, "host", "", "Control server host (ws://host:port) to register with")
	cmd.Flags().StringVar(&enroll, "enroll", "", "One-time enrollment token from the control server")

	cmd.AddCommand(newUpCommand(), newDownCommand(), newStatusCommand())
	return cmd
}

func newUpCommand() *cobra.Command {
	var listen, token, host, enroll string
	cmd := &cobra.Command{
		Use:          "up",
		Short:        "Install and start spectre-agent as a service",
		Long:         "Installs spectre-agent as a system service (systemd or launchd) and starts it with the provided flags.",
		Example:      "spectre-agent up --listen :8081 --host ws://host:8080 --enroll <token>",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return serviceUp(listen, token, host, enroll)
		},
	}

	cmd.Flags().StringVar(&listen, "listen", ":8081", "Address for the agent API and WebSocket server")
	cmd.Flags().StringVar(&token, "token", "changeme", "Auth token for outbound connections from the control server")
	cmd.Flags().StringVar(&host, "host", "", "Control server host (ws://host:port) to register with")
	cmd.Flags().StringVar(&enroll, "enroll", "", "One-time enrollment token from the control server")

	return cmd
}

func newDownCommand() *cobra.Command {
	var purge bool
	cmd := &cobra.Command{
		Use:          "down",
		Short:        "Stop and remove the spectre-agent service",
		Long:         "Stops the spectre-agent service and removes it from the system service configuration.\nUse --purge to also remove device data (device key, lock file).",
		Example:      "spectre-agent down\nspectre-agent down --purge",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return serviceDown(purge)
		},
	}
	cmd.Flags().BoolVar(&purge, "purge", false, "Also remove device data (device key, enrollment state)")
	return cmd
}

func newStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:          "status",
		Short:        "Show the status of the spectre-agent",
		Long:         "Displays whether the agent is running, its PID, device ID, and enrollment state.",
		Example:      "spectre-agent status",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return showStatus()
		},
	}
}

func showStatus() error {
	fmt.Printf("spectre-agent %s\n\n", getAgentVersion())

	running, info := checkRunning()
	if running && info != nil {
		fmt.Printf("  Status:    running (pid %d)\n", info.PID)
		fmt.Printf("  Agent ID:  %s\n", info.AgentID)
		fmt.Printf("  Listen:    %s\n", info.Listen)
		if info.Host != "" {
			fmt.Printf("  Server:    %s\n", info.Host)
		}
	} else {
		fmt.Println("  Status:    not running")
	}

	deviceInfo, err := ensureDeviceInfo()
	if err == nil {
		fmt.Printf("  Device ID: %s\n", deviceInfo.DeviceID)
		if deviceInfo.DeviceKey != "" {
			fmt.Printf("  Enrolled:  yes\n")
		} else {
			fmt.Printf("  Enrolled:  no\n")
		}
	}

	path, _ := deviceInfoPath()
	if path != "" {
		fmt.Printf("  Data dir:  %s\n", filepath.Dir(path))
	}

	svcStatus := serviceStatus()
	if svcStatus != "" {
		fmt.Printf("  Service:   %s\n", svcStatus)
	}

	return nil
}

func checkRunning() (bool, *AgentInstanceInfo) {
	info, err := readExistingInstance(lockFilePath())
	if err != nil {
		return false, nil
	}
	if processRunning(info.PID) {
		return true, info
	}
	return false, nil
}

func serviceStatus() string {
	switch runtime.GOOS {
	case "linux":
		if _, err := os.Stat(systemdUnitPath); err != nil {
			return "not installed"
		}
		out, err := exec.Command("systemctl", "is-active", "spectre-agent.service").Output()
		if err != nil {
			return "installed (inactive)"
		}
		return "installed (" + strings.TrimSpace(string(out)) + ")"
	case "darwin":
		if _, err := os.Stat(launchdPlistPath); err != nil {
			return "not installed"
		}
		return "installed"
	default:
		return ""
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

func runAgent(listen, token, host, enrollToken string) error {
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
		go connectToControlServer(host, token, enrollToken, &deviceInfo, fingerprint)
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
