package main

import (
	"os"
	"regexp"
	"testing"
)

func TestParseTmuxSessions(t *testing.T) {
	// Exactly what `tmux list-sessions -F tmuxListFormat` emits: a
	// Spectre-created session, a legacy single-session name, and two the user
	// started themselves.
	out := "spectre-2a83fb41-48a2-4422-a848-bd2dcbfe53ca\t1784929827\t1\t2\n" +
		"spectre\t1784900000\t0\t1\n" +
		"my-ssh-work\t1784800000\t0\t3\n" +
		"irssi\t1784700000\t1\t1\n"

	sessions := parseTmuxSessions(out)
	if len(sessions) != 4 {
		t.Fatalf("expected 4 sessions, got %d: %+v", len(sessions), sessions)
	}

	first := sessions[0]
	if first.ID != "spectre-2a83fb41-48a2-4422-a848-bd2dcbfe53ca" {
		t.Errorf("unexpected id %q", first.ID)
	}
	if first.CreatedAt != 1784929827 {
		t.Errorf("expected createdAt 1784929827, got %d", first.CreatedAt)
	}
	if !first.Attached {
		t.Error("session_attached=1 should parse as attached")
	}
	if first.Windows != 2 {
		t.Errorf("expected 2 windows, got %d", first.Windows)
	}
	if !first.Managed {
		t.Error("spectre-<uuid> should be managed")
	}

	// The pre-multi-session name is still recognised, so upgrading an agent
	// adopts the old session instead of stranding it.
	if !sessions[1].Managed {
		t.Error("legacy \"spectre\" session should be managed")
	}

	// Sessions started outside Spectre are listed, but not claimed as ours.
	for _, s := range sessions[2:] {
		if s.Managed {
			t.Errorf("%q should not be reported as managed", s.ID)
		}
	}
	if sessions[2].Windows != 3 || sessions[3].Attached != true {
		t.Errorf("external sessions parsed wrong: %+v", sessions[2:])
	}
}

func TestParseTmuxSessionsEmptyAndMalformed(t *testing.T) {
	// No tmux server running produces empty output.
	if got := parseTmuxSessions(""); len(got) != 0 {
		t.Errorf("expected no sessions from empty output, got %+v", got)
	}
	if got := parseTmuxSessions("\n  \n"); len(got) != 0 {
		t.Errorf("expected no sessions from blank output, got %+v", got)
	}
	// Short lines are skipped rather than producing half-filled records.
	if got := parseTmuxSessions("broken\tline\n"); len(got) != 0 {
		t.Errorf("expected malformed line to be skipped, got %+v", got)
	}
	// Non-numeric fields degrade to zero instead of dropping the session.
	got := parseTmuxSessions("weird\tnotanumber\t0\talso-not\n")
	if len(got) != 1 || got[0].CreatedAt != 0 || got[0].Windows != 0 {
		t.Errorf("unexpected parse of non-numeric fields: %+v", got)
	}
}

func TestIsManagedSessionName(t *testing.T) {
	managed := []string{"spectre", "spectre-2a83fb41-48a2-4422-a848-bd2dcbfe53ca", "spectre-anything"}
	for _, name := range managed {
		if !isManagedSessionName(name) {
			t.Errorf("%q should be managed", name)
		}
	}
	unmanaged := []string{"", "my-ssh-work", "irssi", "notspectre", "spectr"}
	for _, name := range unmanaged {
		if isManagedSessionName(name) {
			t.Errorf("%q should not be managed", name)
		}
	}
}

func TestNewSessionID(t *testing.T) {
	pattern := regexp.MustCompile(`^spectre-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := newSessionID()
		if !pattern.MatchString(id) {
			t.Fatalf("id %q is not a spectre-<uuidv4> name", id)
		}
		if !isManagedSessionName(id) {
			t.Fatalf("generated id %q should be managed", id)
		}
		if seen[id] {
			t.Fatalf("duplicate session id %q", id)
		}
		seen[id] = true
	}
}

func TestInventoryReportsRawShellSessions(t *testing.T) {
	// Without tmux, in-memory sessions are the entire inventory. A session with
	// no PTY (one that has exited) must not be offered as attachable.
	readEnd, writeEnd, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	defer readEnd.Close()
	defer writeEnd.Close()

	m := newPtyManager()
	m.sessions["spectre-live"] = &ptySession{ptm: readEnd, stop: make(chan struct{}), sessionID: "spectre-live"}
	m.sessions["spectre-dead"] = newPtySession("spectre-dead")

	inv := m.inventory()

	var live []SessionInfo
	for _, s := range inv {
		if s.ID == "spectre-live" || s.ID == "spectre-dead" {
			live = append(live, s)
		}
	}
	if len(live) != 1 {
		t.Fatalf("expected only the live session in the inventory, got %+v", live)
	}
	if live[0].ID != "spectre-live" || !live[0].Live || !live[0].Managed {
		t.Errorf("unexpected inventory entry: %+v", live[0])
	}
}
