package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

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

const hostFlagDoc = "Control server URL, e.g. wss://spectre.example.com"
const authKeyFlagDoc = "Auth key from the Spectre UI (or $SPECTRE_AUTHKEY). Omit to approve this machine interactively."

// resolveAuthKey prefers the flag but falls back to the environment.
//
// An auth key passed as a flag is visible in `ps` to every user on the machine
// for as long as the process runs, so anything non-interactive should use the
// environment instead.
func resolveAuthKey(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	return os.Getenv("SPECTRE_AUTHKEY")
}

func newRootCommand() *cobra.Command {
	var host, authKey string
	cmd := &cobra.Command{
		Use:   "spectre-agent",
		Short: "Connect this machine to a Spectre control server",
		Long: "Runs the Spectre agent in the foreground.\n\n" +
			"The agent dials out to the control server and never listens on a port,\n" +
			"so it works behind NAT and firewalls.",
		Example:      "  spectre-agent run --host wss://spectre.example.com --authkey sk_...",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return runAgent(host, resolveAuthKey(authKey))
		},
	}
	cmd.Flags().StringVar(&host, "host", "", hostFlagDoc)
	cmd.Flags().StringVar(&authKey, "authkey", "", authKeyFlagDoc)

	cmd.AddCommand(newRunCommand(), newUpCommand(), newDownCommand(), newStatusCommand())
	return cmd
}

func newRunCommand() *cobra.Command {
	var host, authKey string
	cmd := &cobra.Command{
		Use:          "run",
		Short:        "Run the agent in the foreground",
		Example:      "  spectre-agent run --host wss://spectre.example.com --authkey sk_...",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return runAgent(host, resolveAuthKey(authKey))
		},
	}
	cmd.Flags().StringVar(&host, "host", "", hostFlagDoc)
	cmd.Flags().StringVar(&authKey, "authkey", "", authKeyFlagDoc)
	return cmd
}

func newUpCommand() *cobra.Command {
	var host, authKey string
	cmd := &cobra.Command{
		Use:   "up",
		Short: "Enroll this machine and install it as a service",
		Long: "Enrolls this machine with the control server and installs a systemd or\n" +
			"launchd service so it reconnects on boot.\n\n" +
			"With --authkey, enrollment is non-interactive. Without one, the agent\n" +
			"prints a code to approve in the Spectre web UI.",
		Example: "  sudo spectre-agent up --host wss://spectre.example.com --authkey sk_...\n" +
			"  sudo spectre-agent up --host wss://spectre.example.com",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			if host == "" {
				return fmt.Errorf("--host is required (e.g. --host wss://spectre.example.com)")
			}
			return serviceUp(host, resolveAuthKey(authKey))
		},
	}
	cmd.Flags().StringVar(&host, "host", "", hostFlagDoc)
	cmd.Flags().StringVar(&authKey, "authkey", "", authKeyFlagDoc)
	return cmd
}

func newDownCommand() *cobra.Command {
	var purge bool
	cmd := &cobra.Command{
		Use:          "down",
		Short:        "Stop and remove the spectre-agent service",
		Long:         "Stops the service and removes it.\nUse --purge to also delete this machine's device key.",
		Example:      "  sudo spectre-agent down\n  sudo spectre-agent down --purge",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return serviceDown(purge)
		},
	}
	cmd.Flags().BoolVar(&purge, "purge", false, "Also delete the device key and enrollment state")
	return cmd
}

func newStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:          "status",
		Short:        "Show whether the agent is running and enrolled",
		Example:      "  spectre-agent status",
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
			fmt.Println("  Enrolled:  yes")
		} else {
			fmt.Println("  Enrolled:  no")
		}
	}

	if path, _ := deviceInfoPath(); path != "" {
		fmt.Printf("  Data dir:  %s\n", filepath.Dir(path))
	}

	if svcStatus := serviceStatus(); svcStatus != "" {
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
