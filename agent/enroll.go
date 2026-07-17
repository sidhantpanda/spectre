package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

// Interactive enrollment, for when the agent has no auth key.
//
// The machine asks the server to register an approval request, prints a short
// code, and waits. An admin who is already signed in to the web UI approves the
// code, and the device key comes back on the next poll. This is the same shape
// as OAuth's device authorization grant: the machine being enrolled never needs
// to hold an admin credential, and nothing is trusted until a human says so.

const (
	pollInterval   = 2 * time.Second
	enrollHTTPTime = 15 * time.Second
)

type approvalRequest struct {
	Hostname string `json:"hostname"`
	DeviceID string `json:"deviceId"`
}

type approvalResponse struct {
	UserCode  string `json:"userCode"`
	PollToken string `json:"pollToken"`
	ExpiresAt int64  `json:"expiresAt"`
}

type pollRequest struct {
	PollToken string `json:"pollToken"`
}

type pollResponse struct {
	Status    string `json:"status"`
	DeviceKey string `json:"deviceKey"`
}

func enrollInteractively(host, deviceID string) (string, error) {
	baseErr := "interactive enrollment"

	hostname, _ := os.Hostname()
	reqURL, err := normalizeServerURL(host, "http", "/devices/approval-request")
	if err != nil {
		return "", fmt.Errorf("%s: %w", baseErr, err)
	}

	var approval approvalResponse
	if err := postJSON(reqURL, approvalRequest{Hostname: hostname, DeviceID: deviceID}, &approval); err != nil {
		return "", fmt.Errorf("%s: %w", baseErr, err)
	}

	uiURL, _ := normalizeServerURL(host, "http", "/enroll")
	fmt.Fprintf(os.Stderr, "\nTo add this machine, open Spectre and approve it:\n\n")
	fmt.Fprintf(os.Stderr, "    %s\n\n", uiURL)
	fmt.Fprintf(os.Stderr, "    Code:  %s\n\n", approval.UserCode)
	fmt.Fprintf(os.Stderr, "Waiting for approval...\n")

	pollURL, err := normalizeServerURL(host, "http", "/devices/approval-poll")
	if err != nil {
		return "", fmt.Errorf("%s: %w", baseErr, err)
	}

	deadline := time.Unix(0, approval.ExpiresAt*int64(time.Millisecond))
	for time.Now().Before(deadline) {
		time.Sleep(pollInterval)

		var result pollResponse
		if err := postJSON(pollURL, pollRequest{PollToken: approval.PollToken}, &result); err != nil {
			// A transient network blip should not abandon an enrollment the
			// operator is actively approving; keep polling until it expires.
			continue
		}

		switch result.Status {
		case "approved":
			fmt.Fprintf(os.Stderr, "Approved. This machine is now enrolled.\n")
			return result.DeviceKey, nil
		case "expired":
			return "", fmt.Errorf("%s: request expired before it was approved", baseErr)
		}
	}

	return "", fmt.Errorf("%s: timed out waiting for approval", baseErr)
}

// enrollWithAuthKey trades an auth key for this machine's device key in a
// single connection, so the auth key is never written to the service file.
func enrollWithAuthKey(host, authKey, deviceID string) (string, error) {
	wsURL, err := normalizeServerURL(host, "ws", "/agents/register")
	if err != nil {
		return "", err
	}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+authKey)

	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = enrollHTTPTime

	conn, resp, err := dialer.Dial(wsURL, header)
	if err != nil {
		return "", fmt.Errorf("could not reach %s: %w%s", wsURL, err, responseDetail(resp))
	}
	defer conn.Close()

	hostname, _ := os.Hostname()
	hello := AgentMessage{
		Type:         "hello",
		AgentID:      deviceID,
		AgentVersion: getAgentVersion(),
		Fingerprint:  map[string]any{"hostname": hostname},
	}
	if err := conn.WriteJSON(hello); err != nil {
		return "", err
	}

	_ = conn.SetReadDeadline(time.Now().Add(enrollHTTPTime))
	for {
		var msg ControlMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return "", fmt.Errorf("no device key received: %w", err)
		}
		if msg.Type == "enrolled" && msg.DeviceKey != "" {
			return msg.DeviceKey, nil
		}
	}
}

func postJSON(url string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: enrollHTTPTime}
	resp, err := client.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %s: %s", resp.Status, bytes.TrimSpace(data))
	}
	return json.Unmarshal(data, out)
}
