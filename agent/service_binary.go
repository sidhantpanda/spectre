package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// Where the installed service runs its binary from.
//
// An agent can only update itself if it can *replace* its own binary, and
// replacing means rename(2) — writing in place fails with ETXTBSY while the
// binary is executing. rename checks write permission on the containing
// directory, not on the file, so owning the binary is not enough.
//
// A sudo install lands the binary in root-owned /usr/local/bin but runs the
// service as the invoking user, which is exactly the combination that cannot
// self-update. When that is the case, `up` moves the real binary into the
// agent's own state directory — which the service account owns — and leaves a
// symlink behind at the original path. One binary, reachable by its usual
// name, writable by the process that has to replace it.

func serviceBinDir() string {
	return filepath.Join(serviceAgentHome(), "bin")
}

func serviceBinaryPath() string {
	return filepath.Join(serviceBinDir(), "spectre-agent")
}

// Indirection so tests can stand in for a different service account without
// needing root to chown files.
var serviceAccountIDsFn = serviceAccountIDs

// chownPath is a seam: `up` runs as root and really does chown, but a test
// cannot hand files to another account without being root itself.
var chownPath = os.Chown

// resolveServiceBinary returns the path the unit should exec, relocating the
// binary first when its current directory would be read-only to the service.
//
// exe must already be symlink-resolved. Re-running `up` is a no-op: the second
// time round exe already resolves to the staged path.
func resolveServiceBinary(exe string) (string, error) {
	uid, gid, hasAccount := serviceAccountIDsFn()
	if !hasAccount {
		return exe, nil // the service runs as root; it can rewrite anything
	}

	staged := serviceBinaryPath()
	if exe == staged {
		return exe, nil // already relocated by an earlier `up`
	}
	if dirWritableBy(filepath.Dir(exe), uid, gid) {
		return exe, nil // it can already replace itself where it stands
	}

	if err := copyExecutable(exe, staged); err != nil {
		return "", err
	}
	// The directory is the part that matters: rename(2) into it is how an
	// update lands.
	if err := chownPath(serviceBinDir(), uid, gid); err != nil {
		return "", fmt.Errorf("chown %s: %w", serviceBinDir(), err)
	}
	if err := chownPath(staged, uid, gid); err != nil {
		return "", fmt.Errorf("chown %s: %w", staged, err)
	}

	// Leave the original path working, so `spectre-agent ...` keeps resolving
	// and the CLI updates the very same file the service runs.
	if err := replaceWithSymlink(exe, staged); err != nil {
		return "", err
	}
	// Remembered because os.Executable() cannot recover it later: on Linux it
	// reads /proc/self/exe, which is already symlink-resolved, so a running
	// agent has no idea it was reached via /usr/local/bin.
	if err := os.WriteFile(launcherRecordPath(), []byte(exe), 0o644); err != nil {
		fmt.Printf("  warning: could not record the original binary path: %v\n", err)
	}

	fmt.Printf("Moved the agent binary to %s so it can update itself without root.\n", staged)
	fmt.Printf("  %s is now a symlink to it.\n", exe)
	return staged, nil
}

// dirWritableBy reports whether uid/gid could create or rename a file in dir.
func dirWritableBy(dir string, uid, gid int) bool {
	info, err := os.Stat(dir)
	if err != nil {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	mode := info.Mode().Perm()
	switch {
	case int(stat.Uid) == uid:
		return mode&0o200 != 0
	case int(stat.Gid) == gid:
		return mode&0o020 != 0
	default:
		return mode&0o002 != 0
	}
}

// copyExecutable writes src to dst atomically, leaving it executable.
func copyExecutable(src, dst string) error {
	if src == dst {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(dst), err)
	}

	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("read %s: %w", src, err)
	}
	defer in.Close()

	// Staged then renamed, so the unit never points at a half-written binary.
	tmp := dst + ".staging"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("install %s: %w", dst, err)
	}
	return nil
}

// replaceWithSymlink points path at target, atomically.
//
// The symlink is built under a temporary name and renamed over the original, so
// there is never a moment where `spectre-agent` resolves to nothing.
func replaceWithSymlink(path, target string) error {
	tmp := path + ".symlink-staging"
	_ = os.Remove(tmp)
	if err := os.Symlink(target, tmp); err != nil {
		return fmt.Errorf("link %s -> %s: %w", path, target, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("replace %s with a link to %s: %w", path, target, err)
	}
	return nil
}

// launcherRecordPath stores where the binary lived before relocation.
func launcherRecordPath() string {
	return filepath.Join(serviceBinDir(), "launcher-path")
}

// restoreRelocatedBinary un-does the relocation before `down --purge` deletes
// the state directory.
//
// Purging removes /var/lib/spectre-agent, which is where the real binary now
// lives — leaving the symlink at /usr/local/bin dangling and `spectre-agent`
// broken. This copies the binary back to its original path first, so removing
// the service leaves the command working, exactly as it did before relocation.
//
// Returns a function to run after the purge, or nil when there is nothing to
// restore.
func restoreRelocatedBinary() func() {
	recorded, err := os.ReadFile(launcherRecordPath())
	if err != nil {
		return nil // never relocated
	}
	launcher := strings.TrimSpace(string(recorded))
	if launcher == "" {
		return nil
	}

	info, err := os.Lstat(launcher)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		return nil // someone already replaced it with a real binary
	}

	staged := serviceBinaryPath()
	if _, err := os.Stat(staged); err != nil {
		return nil
	}

	// Rescued outside the tree about to be deleted, next to where it belongs.
	rescue := launcher + ".restoring"
	if err := copyExecutable(staged, rescue); err != nil {
		fmt.Printf("  warning: could not preserve the agent binary: %v\n", err)
		return nil
	}
	return func() {
		if err := os.Rename(rescue, launcher); err != nil {
			fmt.Printf("  warning: could not restore %s: %v\n", launcher, err)
			os.Remove(rescue)
			return
		}
		fmt.Printf("  restored the agent binary to %s\n", launcher)
	}
}
