package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

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
