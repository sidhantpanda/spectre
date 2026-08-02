package main

import (
	"os"
	"strings"

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

	cmd.AddCommand(newRunCommand(), newUpCommand(), newDownCommand(), newUpdateCommand(), newStatusCommand())
	return cmd
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
