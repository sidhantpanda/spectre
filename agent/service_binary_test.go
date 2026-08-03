package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// asServiceAccount pretends the service runs as the given account. `up` itself
// runs as root, so the test process stays the owner of everything it creates —
// what matters is whether *that account* could write, which is the question
// resolveServiceBinary asks.
func asServiceAccount(t *testing.T, uid, gid int) *[]string {
	t.Helper()
	originalIDs, originalChown := serviceAccountIDsFn, chownPath
	chowned := []string{}
	serviceAccountIDsFn = func() (int, int, bool) { return uid, gid, true }
	// Handing a file to another account needs root; record the intent instead.
	chownPath = func(path string, _ int, _ int) error {
		chowned = append(chowned, path)
		return nil
	}
	t.Cleanup(func() { serviceAccountIDsFn, chownPath = originalIDs, originalChown })
	return &chowned
}

// otherAccount is an id this test process is definitely not.
const otherAccount = 999999

// rootOwnedBinDir stands in for /usr/local/bin: mode 0755, owned by whoever is
// running (root, in production), and therefore *not* writable by the separate
// account the service runs as.
func rootOwnedBinDir(t *testing.T, contents string) string {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(dir, "spectre-agent")
	if err := os.WriteFile(exe, []byte(contents), 0o755); err != nil {
		t.Fatalf("seed exe: %v", err)
	}
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	return exe
}

// The core of the fix: a binary the service cannot replace gets moved somewhere
// it can, and the original path keeps working as a symlink.
func TestResolveServiceBinaryRelocatesAndSymlinksBack(t *testing.T) {
	chowned := asServiceAccount(t, otherAccount, otherAccount)

	home := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", home)
	exe := rootOwnedBinDir(t, "#!/bin/sh\nexit 0\n")

	resolved, err := resolveServiceBinary(exe)
	if err != nil {
		t.Fatalf("resolveServiceBinary: %v", err)
	}

	if resolved != serviceBinaryPath() {
		t.Fatalf("unit would exec %s, want %s", resolved, serviceBinaryPath())
	}
	if !strings.HasPrefix(resolved, home) {
		t.Fatalf("relocated outside the agent home: %s", resolved)
	}

	// The regression this exists to prevent: the service must be able to
	// rename(2) into the directory it execs from, or self-update is impossible.
	// That is what handing the *directory* to the service account buys.
	if !contains(*chowned, filepath.Dir(resolved)) {
		t.Fatalf("the directory holding the binary was never given to the service account; chowned=%v", *chowned)
	}
	if !contains(*chowned, resolved) {
		t.Fatalf("the binary itself was never given to the service account; chowned=%v", *chowned)
	}

	body, err := os.ReadFile(resolved)
	if err != nil {
		t.Fatalf("read relocated: %v", err)
	}
	if !strings.Contains(string(body), "exit 0") {
		t.Fatalf("relocated copy has the wrong contents: %q", body)
	}

	// The original path still resolves, and to the very same file — so the CLI
	// and the service can never drift onto different versions.
	info, err := os.Lstat(exe)
	if err != nil {
		t.Fatalf("original path is gone: %v", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("original path should have become a symlink")
	}
	via, err := filepath.EvalSymlinks(exe)
	if err != nil {
		t.Fatalf("symlink does not resolve: %v", err)
	}
	if realResolved, _ := filepath.EvalSymlinks(resolved); via != realResolved {
		t.Fatalf("symlink points at %s, not the relocated binary %s", via, realResolved)
	}
	if _, err := os.Stat(resolved + ".staging"); err == nil {
		t.Fatal("left a staging file behind")
	}
}

// Running `up` twice must not relocate a second time or break the symlink.
func TestResolveServiceBinaryIsIdempotent(t *testing.T) {
	asServiceAccount(t, otherAccount, otherAccount)
	home := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", home)

	staged := serviceBinaryPath()
	if err := os.MkdirAll(filepath.Dir(staged), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(staged, []byte("x"), 0o755); err != nil {
		t.Fatalf("seed: %v", err)
	}

	resolved, err := resolveServiceBinary(staged)
	if err != nil {
		t.Fatalf("resolveServiceBinary: %v", err)
	}
	if resolved != staged {
		t.Fatalf("relocated an already-relocated binary: %s", resolved)
	}
}

// Nothing to solve when the service already owns the directory it runs from.
func TestResolveServiceBinaryLeavesAWritableLocationAlone(t *testing.T) {
	asServiceAccount(t, os.Getuid(), os.Getgid())
	t.Setenv("SPECTRE_AGENT_HOME", t.TempDir())

	dir := t.TempDir()
	exe := filepath.Join(dir, "spectre-agent")
	if err := os.WriteFile(exe, []byte("x"), 0o755); err != nil {
		t.Fatalf("seed: %v", err)
	}

	resolved, err := resolveServiceBinary(exe)
	if err != nil {
		t.Fatalf("resolveServiceBinary: %v", err)
	}
	if resolved != exe {
		t.Fatalf("relocated unnecessarily: %s", resolved)
	}
}

// A service running as root can already replace anything.
func TestResolveServiceBinaryLeavesRootAlone(t *testing.T) {
	original := serviceAccountIDsFn
	serviceAccountIDsFn = func() (int, int, bool) { return 0, 0, false }
	defer func() { serviceAccountIDsFn = original }()

	exe := filepath.Join(t.TempDir(), "spectre-agent")
	if err := os.WriteFile(exe, []byte("x"), 0o755); err != nil {
		t.Fatalf("seed: %v", err)
	}

	resolved, err := resolveServiceBinary(exe)
	if err != nil {
		t.Fatalf("resolveServiceBinary: %v", err)
	}
	if resolved != exe {
		t.Fatalf("a root service needs no relocation, got %s", resolved)
	}
}

func TestDirWritableBy(t *testing.T) {
	dir := t.TempDir()
	uid, gid := os.Getuid(), os.Getgid()

	if !dirWritableBy(dir, uid, gid) {
		t.Fatal("own temp dir should be writable")
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	if os.Geteuid() != 0 && dirWritableBy(dir, uid, gid) {
		t.Fatal("a read-only dir should not report writable")
	}
	if dirWritableBy(filepath.Join(dir, "missing"), uid, gid) {
		t.Fatal("a missing dir should not report writable")
	}
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// Purging deletes the directory the real binary was moved into. Without a
// restore, `spectre-agent` is left as a symlink to nothing.
func TestPurgeRestoresTheRelocatedBinary(t *testing.T) {
	asServiceAccount(t, otherAccount, otherAccount)
	home := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", home)

	exe := rootOwnedBinDir(t, "#!/bin/sh\nexit 0\n")
	if _, err := resolveServiceBinary(exe); err != nil {
		t.Fatalf("resolveServiceBinary: %v", err)
	}

	restore := restoreRelocatedBinary()
	if restore == nil {
		t.Fatal("nothing scheduled to restore, so the purge would leave a dangling symlink")
	}

	// Stand in for purgeDataDirs removing the state tree.
	if err := os.RemoveAll(home); err != nil {
		t.Fatalf("purge: %v", err)
	}
	restore()

	info, err := os.Lstat(exe)
	if err != nil {
		t.Fatalf("the command is gone after purge: %v", err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		t.Fatal("left a dangling symlink instead of a real binary")
	}
	body, err := os.ReadFile(exe)
	if err != nil || !strings.Contains(string(body), "exit 0") {
		t.Fatalf("restored binary is wrong: %q (%v)", body, err)
	}
	if info.Mode().Perm()&0o100 == 0 {
		t.Fatalf("restored binary is not executable: %v", info.Mode())
	}
}

// A plain install that was never relocated must not be touched.
func TestPurgeRestoresNothingWhenNeverRelocated(t *testing.T) {
	t.Setenv("SPECTRE_AGENT_HOME", t.TempDir())
	if restore := restoreRelocatedBinary(); restore != nil {
		t.Fatal("scheduled a restore for an install that was never relocated")
	}
}
