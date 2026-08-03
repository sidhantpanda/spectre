package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

// Self-update: fetch the latest release from GitHub and swap this binary for
// it, in place.
//
// Enrollment is deliberately untouched. The device key lives in the agent's
// state directory (SPECTRE_AGENT_HOME, or /var/lib/spectre-agent for the
// installed service), and nothing here reads or writes it — so an updated
// agent reconnects with the credentials it already had and never needs a new
// auth key.

const (
	updateRepo        = "sidhantpanda/spectre"
	githubAPIBase     = "https://api.github.com"
	githubReleaseBase = "https://github.com"
	// Big enough for a cold network, small enough to not hang a boot script.
	updateHTTPTimeout = 5 * time.Minute
	// The downloaded binary only has to print its usage; anything slower than
	// this is a binary that cannot run here.
	smokeTestTimeout = 20 * time.Second
)

type updateOptions struct {
	// Release to install. Empty means whatever GitHub calls latest.
	tag string
	// Report what would happen and exit without touching anything.
	checkOnly bool
	// Reinstall even when the running version already matches.
	force bool
	// skipRestart is set when the caller *is* the supervised process and will
	// exit to pick up the new binary. Asking systemd to restart the service
	// from inside that service would both duplicate the exit and require root,
	// which the service account has not got.
	skipRestart bool
}

// Injectable for tests; the real ones talk to github.com and to the init
// system. A test must never restart the machine's actual agent service.
var (
	updateAPIBase     = githubAPIBase
	updateReleaseBase = githubReleaseBase
	handOff           = handOverToNewBinary
)

// One update at a time. Two clicks in the dashboard must not race two
// downloads onto the same binary.
var updateInProgress atomic.Bool

// handleRemoteUpdate services an "update" message from the control server.
//
// The work happens on its own goroutine: a download plus a service restart
// takes far too long to block the socket read loop, which would stall
// keystrokes and heartbeats and get this machine swept as stale.
//
// The "installed" report is best-effort. A successful update restarts the
// service, which kills this process — often before the message is flushed. The
// dashboard's real confirmation is the machine reconnecting on a new version.
func handleRemoteUpdate(conn *safeConn, version string) {
	if !updateInProgress.CompareAndSwap(false, true) {
		_ = conn.writeJSON(AgentMessage{
			Type: "updateStatus", State: "failed", Version: version,
			Error: "an update is already in progress",
		})
		return
	}

	go func() {
		defer updateInProgress.Store(false)

		log.Printf("control server requested an update%s", versionSuffix(version))
		_ = conn.writeJSON(AgentMessage{Type: "updateStatus", State: "started", Version: version})

		if err := runUpdate(updateOptions{tag: version, skipRestart: true}); err != nil {
			log.Printf("update failed: %v", err)
			_ = conn.writeJSON(AgentMessage{
				Type: "updateStatus", State: "failed", Version: version, Error: err.Error(),
			})
			return
		}
		_ = conn.writeJSON(AgentMessage{Type: "updateStatus", State: "installed", Version: version})

		// Exiting is how the new binary gets picked up. Both supervisors are
		// configured to restart us (systemd Restart=always, launchd KeepAlive),
		// and exiting needs no privileges — asking systemctl or launchctl to
		// restart the service does, which a non-root service account has not
		// got. Give the message above a moment to reach the wire first.
		log.Printf("update installed; exiting so the service manager restarts on the new binary")
		time.Sleep(500 * time.Millisecond)
		_ = conn.close()
		os.Exit(0)
	}()
}

func versionSuffix(version string) string {
	if version == "" {
		return " to the latest release"
	}
	return " to " + version
}

func runUpdate(opts updateOptions) error {
	exe, err := currentExecutablePath()
	if err != nil {
		return err
	}
	return updateBinaryAt(exe, opts)
}

// updateBinaryAt is runUpdate with the install location already resolved, so
// the whole flow can be exercised against a binary that is not this process.
func updateBinaryAt(exe string, opts updateOptions) error {
	var err error
	current := getAgentVersion()
	fmt.Printf("spectre-agent %s (%s/%s)\n", current, runtime.GOOS, runtime.GOARCH)

	target := opts.tag
	if target == "" {
		fmt.Println("Checking GitHub for the latest release...")
		target, err = latestReleaseTag()
		if err != nil {
			return err
		}
	}

	if sameVersion(current, target) && !opts.force {
		fmt.Printf("Already on %s; nothing to do.\n", target)
		return nil
	}

	fmt.Printf("Latest release is %s.\n", target)
	if opts.checkOnly {
		fmt.Printf("An update is available. Run 'spectre-agent update' to install it.\n")
		return nil
	}

	// Fail on permissions before spending a download on it. Writing the new
	// binary means replacing a file in a directory that is usually root-owned.
	if err := checkWritableDir(filepath.Dir(exe)); err != nil {
		return err
	}

	asset := agentAssetName(runtime.GOOS, runtime.GOARCH)
	url := fmt.Sprintf("%s/%s/releases/download/%s/%s", updateReleaseBase, updateRepo, target, asset)

	workDir, err := os.MkdirTemp(filepath.Dir(exe), ".spectre-agent-update-")
	if err != nil {
		return fmt.Errorf("create staging directory next to %s: %w", exe, err)
	}
	defer os.RemoveAll(workDir)

	fmt.Printf("Downloading %s...\n", asset)
	staged, err := downloadAgentBinary(url, workDir)
	if err != nil {
		return err
	}

	// A truncated download or a wrong-architecture asset is far better caught
	// here than by a service that will not start afterwards.
	if err := smokeTest(staged); err != nil {
		return fmt.Errorf("downloaded binary does not run on this machine: %w", err)
	}

	if err := replaceExecutable(exe, staged); err != nil {
		return err
	}
	fmt.Printf("Installed %s to %s\n", target, exe)

	// A remote update is run by the service process itself, which exits below;
	// systemd's Restart=always brings it back on the new binary with no
	// privileged systemctl call in between.
	if opts.skipRestart {
		return nil
	}

	handOff()

	fmt.Println("This machine stays enrolled — its device key was not touched.")
	return nil
}

func currentExecutablePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable: %w", err)
	}
	// Follow symlinks so the update lands on the real file rather than
	// replacing a link that points at it.
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return exe, nil
}

// agentAssetName is the release asset for a platform. Must match the names the
// release workflow uploads.
func agentAssetName(goos, goarch string) string {
	return fmt.Sprintf("spectre-agent-%s-%s.tar.gz", goos, goarch)
}

// sameVersion compares release tags, tolerating the leading "v" being present
// on one side and not the other. A dev build never matches a release.
func sameVersion(a, b string) bool {
	norm := func(s string) string { return strings.TrimPrefix(strings.TrimSpace(s), "v") }
	if a == "" || b == "" {
		return false
	}
	return norm(a) == norm(b)
}

// latestReleaseTag asks GitHub which release is current. /releases/latest
// already excludes drafts and prereleases, so there is nothing to filter.
func latestReleaseTag() (string, error) {
	url := fmt.Sprintf("%s/repos/%s/releases/latest", updateAPIBase, updateRepo)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "spectre-agent/"+getAgentVersion())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("reach GitHub: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return "", fmt.Errorf("GitHub rate-limited this machine (HTTP %d); try again later or pass --tag", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub returned HTTP %d looking up the latest release", resp.StatusCode)
	}

	var release struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return "", fmt.Errorf("parse GitHub response: %w", err)
	}
	if release.TagName == "" {
		return "", errors.New("GitHub reported no latest release for this repository")
	}
	return release.TagName, nil
}

// downloadAgentBinary fetches the release tarball and unpacks the agent out of
// it into destDir, returning the path to the extracted binary.
func downloadAgentBinary(url, destDir string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "spectre-agent/"+getAgentVersion())

	client := &http.Client{Timeout: updateHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", fmt.Errorf("this release has no build for %s/%s (looked for %s)",
			runtime.GOOS, runtime.GOARCH, filepath.Base(url))
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}

	return extractAgentBinary(resp.Body, destDir)
}

// extractAgentBinary pulls the spectre-agent executable out of a .tar.gz.
func extractAgentBinary(r io.Reader, destDir string) (string, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return "", fmt.Errorf("read release archive: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("read release archive: %w", err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		// Only ever the basename: a crafted archive must not be able to write
		// outside destDir via a path like ../../etc/cron.d/x.
		name := filepath.Base(header.Name)
		if !strings.HasPrefix(name, "spectre-agent") {
			continue
		}

		dest := filepath.Join(destDir, "spectre-agent.new")
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return "", fmt.Errorf("write %s: %w", dest, err)
		}
		// Bounded so a hostile or corrupt archive cannot fill the disk.
		if _, err := io.Copy(out, io.LimitReader(tr, 512<<20)); err != nil {
			out.Close()
			return "", fmt.Errorf("write %s: %w", dest, err)
		}
		if err := out.Close(); err != nil {
			return "", fmt.Errorf("write %s: %w", dest, err)
		}
		return dest, nil
	}
	return "", errors.New("no spectre-agent binary inside the release archive")
}

// smokeTest runs the downloaded binary to prove it executes here before it is
// allowed to replace the one that already works.
func smokeTest(path string) error {
	ctx, cancel := context.WithTimeout(context.Background(), smokeTestTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, path, "--help")
	// Its usage text is not the operator's business; only whether it ran.
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	return cmd.Run()
}

// replaceExecutable swaps the new binary in atomically.
//
// The rename is within one directory, so it is atomic and never leaves a
// half-written agent on disk. Replacing the file of a *running* process is
// fine on Linux and macOS: the running one keeps its open inode and only the
// next start picks up the new file.
func replaceExecutable(target, staged string) error {
	// Carry over the existing mode so a deployment that tightened permissions
	// on the binary keeps them.
	mode := os.FileMode(0o755)
	if info, err := os.Stat(target); err == nil {
		mode = info.Mode().Perm()
	}
	if err := os.Chmod(staged, mode); err != nil {
		return fmt.Errorf("set permissions on the new binary: %w", err)
	}
	if err := os.Rename(staged, target); err != nil {
		return fmt.Errorf("install the new binary over %s: %w", target, err)
	}
	return nil
}

// checkWritableDir reports a permission problem as advice rather than as a
// failure three steps later.
func checkWritableDir(dir string) error {
	probe, err := os.CreateTemp(dir, ".spectre-agent-write-test-")
	if err != nil {
		return fmt.Errorf("cannot write to %s: %w\nre-run with sudo", dir, err)
	}
	name := probe.Name()
	probe.Close()
	return os.Remove(name)
}

// restartInstalledService restarts the agent service when there is one, so the
// new binary is what is actually running. Reports whether it found one.
// serviceInstalled reports whether an init system is managing this agent, and
// will therefore start it again when it exits.
func serviceInstalled() bool {
	switch runtime.GOOS {
	case "linux":
		_, err := os.Stat(systemdUnitPath)
		return err == nil
	case "darwin":
		_, err := os.Stat(launchdPlistPath)
		return err == nil
	default:
		return false
	}
}

// handOverToNewBinary gets the running agent onto the binary just installed.
//
// It signals the agent rather than asking the service manager to restart it:
// `systemctl restart` needs root, but the CLI and the service run as the same
// account, so a plain SIGTERM does not. The agent shuts down cleanly on it, and
// systemd's Restart=always (or launchd's KeepAlive) starts the new binary.
// That is what lets `spectre-agent update` work without sudo.
func handOverToNewBinary() {
	running, info := checkRunning()
	if !running || info == nil {
		fmt.Println("No agent running here; the new binary is in place for the next start.")
		return
	}

	if err := syscall.Kill(info.PID, syscall.SIGTERM); err != nil {
		fmt.Printf("warning: could not signal the running agent (pid %d): %v\n", info.PID, err)
		fmt.Println("         the new binary is installed; restart the agent to pick it up.")
		return
	}
	if serviceInstalled() {
		fmt.Println("Signalled the running agent; the service manager will start it on the new version.")
	} else {
		fmt.Println("Stopped the running agent; start it again to run the new version.")
	}
}
