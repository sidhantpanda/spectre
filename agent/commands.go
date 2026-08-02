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

func newUpdateCommand() *cobra.Command {
	var opts updateOptions
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update the agent to the latest GitHub release",
		Long: "Downloads the newest release for this machine's OS and architecture,\n" +
			"replaces this binary with it, and restarts the service if one is installed.\n\n" +
			"Enrollment is left alone: the machine keeps its device key and needs no\n" +
			"new auth key. Updating a system-wide install needs root.",
		Example: "  sudo spectre-agent update\n" +
			"  spectre-agent update --check\n" +
			"  sudo spectre-agent update --tag v1.2.3",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			return runUpdate(opts)
		},
	}
	cmd.Flags().BoolVar(&opts.checkOnly, "check", false, "Only report whether an update is available")
	cmd.Flags().StringVar(&opts.tag, "tag", "", "Release to install, e.g. v1.2.3. Defaults to the latest")
	cmd.Flags().BoolVar(&opts.force, "force", false, "Reinstall even if already on that version")
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
