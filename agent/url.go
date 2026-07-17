package main

import (
	"fmt"
	"net/url"
	"strings"
)

// normalizeServerURL turns an operator-supplied host into a concrete URL.
// It accepts "example.com", "wss://example.com" or "https://example.com" and
// normalizes the scheme for the requested transport ("ws" or "http").
//
// Credentials are never placed in the URL: they travel in the Authorization
// header, because URLs are logged by proxies and land in Referer headers.
func normalizeServerURL(host, scheme, path string) (string, error) {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" {
		return "", fmt.Errorf("no control server host provided")
	}

	if !strings.Contains(trimmed, "://") {
		trimmed = "wss://" + trimmed
	}

	u, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	if u.Host == "" {
		return "", fmt.Errorf("invalid control server host %q", host)
	}

	secure := u.Scheme == "wss" || u.Scheme == "https"
	switch scheme {
	case "ws":
		u.Scheme = "ws"
		if secure {
			u.Scheme = "wss"
		}
	case "http":
		u.Scheme = "http"
		if secure {
			u.Scheme = "https"
		}
	default:
		return "", fmt.Errorf("unsupported scheme %q", scheme)
	}

	u.Path = path
	u.RawQuery = ""
	return u.String(), nil
}

// isPlaintext reports whether the host would be contacted without TLS.
func isPlaintext(host string) bool {
	trimmed := strings.TrimSpace(host)
	if !strings.Contains(trimmed, "://") {
		return false // bare hosts default to wss://
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	return u.Scheme == "ws" || u.Scheme == "http"
}

// isLoopback reports whether the host points at this machine, where plaintext
// never leaves the box and is therefore acceptable for development.
func isLoopback(host string) bool {
	trimmed := strings.TrimSpace(host)
	if !strings.Contains(trimmed, "://") {
		trimmed = "wss://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	hostname := u.Hostname()
	return hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1"
}
