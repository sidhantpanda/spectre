package main

import (
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// connectToControlServer dials the control server and establishes the shell bridge.
// It supports three auth modes: enrollment token (first time), stored device key
// (subsequent connections), or legacy shared token (backward compat).
func connectToControlServer(host, legacyToken, enrollToken string, deviceInfo *DeviceInfo, fingerprint map[string]any) {
	deviceKey := deviceInfo.DeviceKey

	if deviceKey != "" {
		enrollToken = ""
		log.Printf("using stored device key for control server auth")
	}

	if strings.HasPrefix(host, "ws://") || (!strings.Contains(host, "://") && !strings.HasPrefix(host, "wss://")) {
		log.Printf("WARNING: connecting to control server over unencrypted ws://. Use wss:// in production.")
	}

	useLegacy := enrollToken == "" && deviceKey == ""
	if useLegacy {
		log.Printf("no device key or enrollment token; using legacy token auth")
	}

	backoff := time.Second
	for {
		var wsURL string
		var err error

		if useLegacy {
			wsURL, err = buildControlServerURL(host, legacyToken)
		} else {
			wsURL, err = buildControlServerURLWithAuth(host, deviceKey, enrollToken)
		}
		if err != nil {
			log.Printf("invalid control server host %q: %v", host, err)
			return
		}

		conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			var details string
			if resp != nil {
				body, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				trimmed := strings.TrimSpace(string(body))
				if trimmed != "" {
					details = fmt.Sprintf(" (HTTP %s: %s)", resp.Status, trimmed)
				} else {
					details = fmt.Sprintf(" (HTTP %s)", resp.Status)
				}
			}
			log.Printf("failed to connect to control server at %s: %v%s", wsURL, err, details)
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}

		log.Printf("connected to control server via %s", wsURL)

		hello := AgentMessage{
			Type:         "hello",
			AgentID:      deviceInfo.DeviceID,
			AgentVersion: getAgentVersion(),
			Fingerprint:  fingerprint,
		}
		if err := conn.WriteJSON(hello); err != nil {
			log.Printf("failed to send handshake to control server: %v", err)
			conn.Close()
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}

		var ack ControlMessage
		if err := conn.ReadJSON(&ack); err != nil {
			log.Printf("failed to read control server ack: %v", err)
			conn.Close()
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}
		if ack.Type != "hello" {
			log.Printf("unexpected handshake response from control server: %v", ack.Type)
			conn.Close()
			backoff = nextBackoff(backoff)
			time.Sleep(backoff)
			continue
		}

		if ack.DeviceKey != "" {
			deviceInfo.DeviceKey = ack.DeviceKey
			if err := saveDeviceInfo(*deviceInfo); err != nil {
				log.Printf("warning: failed to persist device key: %v", err)
			} else {
				log.Printf("enrolled successfully, device key stored")
			}
			deviceKey = ack.DeviceKey
			enrollToken = ""
			useLegacy = false
		}

		backoff = time.Second

		sessions := newPtyManager()
		errCh := make(chan error, 1)
		startPTY := func(session *ptySession) {
			go readFromPTY(conn, session, errCh)
		}
		sessions.reset("default")
		go readFromControl(conn, sessions, errCh, startPTY)
		go sendHeartbeats(conn, errCh)

		if err := <-errCh; err != nil {
			log.Printf("control server connection closed: %v", err)
		}
		sessions.closeAll()
		conn.Close()

		backoff = nextBackoff(backoff)
		time.Sleep(backoff)
	}
}

func nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > 30*time.Second {
		return 30 * time.Second
	}
	return next
}
