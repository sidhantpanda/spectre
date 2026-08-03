package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestAgentAssetNameMatchesReleaseAssets(t *testing.T) {
	// Must match what the release workflow uploads, or update finds a 404.
	if got, want := agentAssetName("linux", "amd64"), "spectre-agent-linux-amd64.tar.gz"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got, want := agentAssetName("darwin", "arm64"), "spectre-agent-darwin-arm64.tar.gz"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestSameVersion(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"v1.2.3", "v1.2.3", true},
		// The build stamps the tag with its "v"; be tolerant either way.
		{"1.2.3", "v1.2.3", true},
		{"v1.2.3", "1.2.3", true},
		{"v1.2.3", "v1.2.4", false},
		// A dev build is never "already up to date".
		{"dev-1785700000", "v1.2.3", false},
		{"", "v1.2.3", false},
		{"v1.2.3", "", false},
	}
	for _, tc := range cases {
		if got := sameVersion(tc.a, tc.b); got != tc.want {
			t.Errorf("sameVersion(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

// tarGz builds a .tar.gz holding the named entries.
func tarGz(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range entries {
		if err := tw.WriteHeader(&tar.Header{
			Name: name, Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg,
		}); err != nil {
			t.Fatalf("write header: %v", err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatalf("write body: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	return buf.Bytes()
}

func TestExtractAgentBinary(t *testing.T) {
	dir := t.TempDir()
	archive := tarGz(t, map[string]string{"spectre-agent-linux-amd64": "#!/bin/sh\nexit 0\n"})

	path, err := extractAgentBinary(bytes.NewReader(archive), dir)
	if err != nil {
		t.Fatalf("extractAgentBinary: %v", err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read extracted: %v", err)
	}
	if !strings.Contains(string(body), "exit 0") {
		t.Fatalf("extracted the wrong contents: %q", body)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm()&0o100 == 0 {
		t.Fatalf("extracted binary is not executable: %v", info.Mode())
	}
}

func TestExtractAgentBinaryRejectsArchiveWithoutAgent(t *testing.T) {
	archive := tarGz(t, map[string]string{"README.md": "nothing to see"})
	if _, err := extractAgentBinary(bytes.NewReader(archive), t.TempDir()); err == nil {
		t.Fatal("expected an error when the archive holds no agent binary")
	}
}

// A release archive is remote input. An entry named ../../x must never be able
// to write outside the staging directory.
func TestExtractAgentBinaryIgnoresPathTraversal(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(dir, "outside.txt")
	archive := tarGz(t, map[string]string{"../../outside.txt": "pwned", "spectre-agent": "ok"})

	path, err := extractAgentBinary(bytes.NewReader(archive), dir)
	if err != nil {
		t.Fatalf("extractAgentBinary: %v", err)
	}
	if filepath.Dir(path) != dir {
		t.Fatalf("wrote outside the staging dir: %s", path)
	}
	if _, err := os.Stat(outside); err == nil {
		t.Fatal("path traversal escaped the staging directory")
	}
}

func TestReplaceExecutableSwapsInPlaceAndKeepsMode(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "spectre-agent")
	staged := filepath.Join(dir, "spectre-agent.new")

	if err := os.WriteFile(target, []byte("old"), 0o750); err != nil {
		t.Fatalf("seed target: %v", err)
	}
	if err := os.WriteFile(staged, []byte("new"), 0o600); err != nil {
		t.Fatalf("seed staged: %v", err)
	}

	if err := replaceExecutable(target, staged); err != nil {
		t.Fatalf("replaceExecutable: %v", err)
	}

	body, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(body) != "new" {
		t.Fatalf("target still holds %q", body)
	}
	// The existing binary's permissions win, so a hardened install stays hardened.
	info, _ := os.Stat(target)
	if info.Mode().Perm() != 0o750 {
		t.Fatalf("mode became %v, want 0750", info.Mode().Perm())
	}
	if _, err := os.Stat(staged); err == nil {
		t.Fatal("staged file should have been renamed away")
	}
}

func TestLatestReleaseTag(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/"+updateRepo+"/releases/latest" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("User-Agent") == "" {
			t.Error("GitHub requires a User-Agent")
		}
		fmt.Fprint(w, `{"tag_name":"v9.9.9","name":"Spectre v9.9.9"}`)
	}))
	defer srv.Close()

	old := updateAPIBase
	updateAPIBase = srv.URL
	defer func() { updateAPIBase = old }()

	tag, err := latestReleaseTag()
	if err != nil {
		t.Fatalf("latestReleaseTag: %v", err)
	}
	if tag != "v9.9.9" {
		t.Fatalf("got %q, want v9.9.9", tag)
	}
}

func TestLatestReleaseTagReportsRateLimiting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	old := updateAPIBase
	updateAPIBase = srv.URL
	defer func() { updateAPIBase = old }()

	_, err := latestReleaseTag()
	if err == nil || !strings.Contains(err.Error(), "rate-limited") {
		t.Fatalf("want a rate-limit error, got %v", err)
	}
}

func TestDownloadAgentBinaryReportsMissingPlatformBuild(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	_, err := downloadAgentBinary(srv.URL+"/missing.tar.gz", t.TempDir())
	if err == nil || !strings.Contains(err.Error(), runtime.GOARCH) {
		t.Fatalf("want an error naming this platform, got %v", err)
	}
}

func TestCheckWritableDirRejectsUnwritableTarget(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root; every directory is writable")
	}
	dir := t.TempDir()
	locked := filepath.Join(dir, "locked")
	if err := os.Mkdir(locked, 0o500); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	if err := checkWritableDir(locked); err == nil {
		t.Fatal("expected an error for a read-only directory")
	} else if !strings.Contains(err.Error(), "sudo") {
		t.Fatalf("error should suggest sudo, got %v", err)
	}
	if err := checkWritableDir(dir); err != nil {
		t.Fatalf("writable dir rejected: %v", err)
	}
}

// stubServiceRestart keeps a test off the machine's real agent: without it, a
// developer box running one gets it signalled — and possibly restarted — by
// `go test`.
func stubServiceRestart(t *testing.T) *bool {
	t.Helper()
	called := false
	old := handOff
	handOff = func() { called = true }
	t.Cleanup(func() { handOff = old })
	return &called
}

// End to end: a fake GitHub, a fake install, and the real update path — down to
// swapping the binary and leaving enrollment alone.
func TestUpdateReplacesTheBinaryAndLeavesEnrollmentAlone(t *testing.T) {
	restarted := stubServiceRestart(t)
	installDir := t.TempDir()
	installed := filepath.Join(installDir, "spectre-agent")
	if err := os.WriteFile(installed, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("seed installed binary: %v", err)
	}

	// The device key the machine is already enrolled with.
	home := t.TempDir()
	t.Setenv("SPECTRE_AGENT_HOME", home)
	infoPath, err := deviceInfoPath()
	if err != nil {
		t.Fatalf("deviceInfoPath: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(infoPath), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	enrollment := `{"deviceId":"abc123","deviceKey":"dk_secret"}`
	if err := os.WriteFile(infoPath, []byte(enrollment), 0o600); err != nil {
		t.Fatalf("seed device info: %v", err)
	}

	newBinary := "#!/bin/sh\nexit 0\n# v9.9.9\n"
	archive := tarGz(t, map[string]string{"spectre-agent-" + runtime.GOOS + "-" + runtime.GOARCH: newBinary})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/releases/latest"):
			fmt.Fprint(w, `{"tag_name":"v9.9.9"}`)
		case strings.HasSuffix(r.URL.Path, agentAssetName(runtime.GOOS, runtime.GOARCH)):
			w.Write(archive)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	oldAPI, oldRelease := updateAPIBase, updateReleaseBase
	updateAPIBase, updateReleaseBase = srv.URL, srv.URL
	defer func() { updateAPIBase, updateReleaseBase = oldAPI, oldRelease }()

	if err := updateBinaryAt(installed, updateOptions{}); err != nil {
		t.Fatalf("updateBinaryAt: %v", err)
	}

	got, err := os.ReadFile(installed)
	if err != nil {
		t.Fatalf("read installed: %v", err)
	}
	if string(got) != newBinary {
		t.Fatalf("binary was not replaced; holds %q", got)
	}

	// The whole point: updating must not cost the machine its enrollment.
	after, err := os.ReadFile(infoPath)
	if err != nil {
		t.Fatalf("device info disappeared: %v", err)
	}
	if string(after) != enrollment {
		t.Fatalf("device info changed: %q", after)
	}

	// No staging directories left behind next to the binary.
	entries, _ := os.ReadDir(installDir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".spectre-agent-update-") {
			t.Fatalf("left a staging directory behind: %s", e.Name())
		}
	}

	// A successful update has to hand the new binary to the running service.
	if !*restarted {
		t.Fatal("update did not attempt to restart the service")
	}
}

func TestUpdateCheckOnlyDoesNotTouchTheBinary(t *testing.T) {
	stubServiceRestart(t)
	installDir := t.TempDir()
	installed := filepath.Join(installDir, "spectre-agent")
	if err := os.WriteFile(installed, []byte("original"), 0o755); err != nil {
		t.Fatalf("seed: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/releases/latest") {
			fmt.Fprint(w, `{"tag_name":"v9.9.9"}`)
			return
		}
		t.Errorf("--check downloaded %s", r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	oldAPI, oldRelease := updateAPIBase, updateReleaseBase
	updateAPIBase, updateReleaseBase = srv.URL, srv.URL
	defer func() { updateAPIBase, updateReleaseBase = oldAPI, oldRelease }()

	if err := updateBinaryAt(installed, updateOptions{checkOnly: true}); err != nil {
		t.Fatalf("updateBinaryAt: %v", err)
	}

	body, _ := os.ReadFile(installed)
	if string(body) != "original" {
		t.Fatalf("--check modified the binary: %q", body)
	}
}

// Already on the requested version: no download, no swap.
func TestUpdateIsANoopWhenAlreadyCurrent(t *testing.T) {
	stubServiceRestart(t)
	installDir := t.TempDir()
	installed := filepath.Join(installDir, "spectre-agent")
	if err := os.WriteFile(installed, []byte("original"), 0o755); err != nil {
		t.Fatalf("seed: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("should not have contacted GitHub: %s", r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	oldAPI, oldRelease := updateAPIBase, updateReleaseBase
	updateAPIBase, updateReleaseBase = srv.URL, srv.URL
	defer func() { updateAPIBase, updateReleaseBase = oldAPI, oldRelease }()

	if err := updateBinaryAt(installed, updateOptions{tag: getAgentVersion()}); err != nil {
		t.Fatalf("updateBinaryAt: %v", err)
	}
	body, _ := os.ReadFile(installed)
	if string(body) != "original" {
		t.Fatalf("binary changed: %q", body)
	}
}
