package main

import "testing"

func TestNormalizeServerURLDefaultsToTLS(t *testing.T) {
	got, err := normalizeServerURL("spectre.example.com", "ws", "/agents/register")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// A bare host must not silently downgrade to plaintext.
	if want := "wss://spectre.example.com/agents/register"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestNormalizeServerURLPreservesScheme(t *testing.T) {
	cases := []struct {
		host, scheme, want string
	}{
		{"wss://s.example.com", "ws", "wss://s.example.com/agents/register"},
		{"ws://localhost:8080", "ws", "ws://localhost:8080/agents/register"},
		{"https://s.example.com", "ws", "wss://s.example.com/agents/register"},
		{"http://localhost:8080", "ws", "ws://localhost:8080/agents/register"},
		{"wss://s.example.com", "http", "https://s.example.com/agents/register"},
		{"ws://localhost:8080", "http", "http://localhost:8080/agents/register"},
	}
	for _, tc := range cases {
		got, err := normalizeServerURL(tc.host, tc.scheme, "/agents/register")
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", tc.host, err)
		}
		if got != tc.want {
			t.Fatalf("%s as %s: got %q, want %q", tc.host, tc.scheme, got, tc.want)
		}
	}
}

func TestNormalizeServerURLDropsSuppliedQuery(t *testing.T) {
	// Credentials belong in the Authorization header; anything a caller tries
	// to smuggle through the URL is discarded.
	got, err := normalizeServerURL("wss://s.example.com/?token=leak", "ws", "/agents/register")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := "wss://s.example.com/agents/register"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestNormalizeServerURLRejectsEmpty(t *testing.T) {
	if _, err := normalizeServerURL("", "ws", "/agents/register"); err == nil {
		t.Fatal("expected an error for an empty host")
	}
}

func TestIsPlaintext(t *testing.T) {
	cases := map[string]bool{
		"ws://host:8080":   true,
		"http://host:8080": true,
		"wss://host":       false,
		"https://host":     false,
		"spectre.test.com": false, // bare hosts default to wss://
	}
	for host, want := range cases {
		if got := isPlaintext(host); got != want {
			t.Fatalf("isPlaintext(%q) = %v, want %v", host, got, want)
		}
	}
}

func TestIsLoopback(t *testing.T) {
	cases := map[string]bool{
		"ws://localhost:8080": true,
		"ws://127.0.0.1:8080": true,
		"http://[::1]:8080":   true,
		"ws://10.0.0.5:8080":  false,
		"wss://example.com":   false,
	}
	for host, want := range cases {
		if got := isLoopback(host); got != want {
			t.Fatalf("isLoopback(%q) = %v, want %v", host, got, want)
		}
	}
}
