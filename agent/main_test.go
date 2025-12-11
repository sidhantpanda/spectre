package main

import (
	"os"
	"strings"
	"testing"
)

func TestReadFileTrim(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "spectre-agent-test")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	content := "example data\n\n"
	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	if err := tmpFile.Close(); err != nil {
		t.Fatalf("failed to close temp file: %v", err)
	}

	trimmed := readFileTrim(tmpFile.Name())
	if trimmed != strings.TrimSpace(content) {
		t.Fatalf("expected %q, got %q", strings.TrimSpace(content), trimmed)
	}

	missing := readFileTrim("/path/does/not/exist")
	if missing != "" {
		t.Fatalf("expected empty string for missing file, got %q", missing)
	}
}

func TestListInterfaces(t *testing.T) {
	macs, nics := listInterfaces()
	if len(nics) == 0 {
		t.Fatalf("expected at least one network interface")
	}
	if len(macs) > len(nics) {
		t.Fatalf("unexpected interface counts: macs=%d nics=%d", len(macs), len(nics))
	}
}
