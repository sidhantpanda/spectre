package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// connectToControlServer maintains the agent's outbound connection to the
// control server, reconnecting with backoff for the life of the process.
//
// The agent only ever dials out; it listens on nothing. That is what lets it
// live behind NAT, and it means there is no port on this machine for anyone to
// find.
//
// Credentials, in order of preference:
//   - a stored device key, from a previous enrollment
//   - an auth key, exchanged for a device key on first connect
//   - interactive approval, where a human approves this machine in the web UI
//
// The ptyManager persists across reconnects so tmux sessions survive drops.
func connectToControlServer(host, authKey string, deviceInfo *DeviceInfo, fingerprint map[string]any) {
	if isPlaintext(host) && !isLoopback(host) {
		log.Printf("WARNING: connecting over plaintext to a non-local host. Terminal I/O and the")
		log.Printf("WARNING: device key are exposed to the network. Use wss:// in production.")
	}

	if deviceInfo.DeviceKey == "" && authKey == "" {
		key, err := enrollInteractively(host, deviceInfo.DeviceID)
		if err != nil {
			log.Printf("%v", err)
			return
		}
		deviceInfo.DeviceKey = key
		if err := saveDeviceInfo(*deviceInfo); err != nil {
			log.Printf("warning: could not persist device key: %v", err)
		}
	}

	sessions := newPtyManager()
	backoff := time.Second

	for {
		credential := deviceInfo.DeviceKey
		if credential == "" {
			credential = authKey
		}

		if err := runConnection(host, credential, deviceInfo, fingerprint, sessions); err != nil {
			log.Printf("control server connection ended: %v", err)
		}

		backoff = nextBackoff(backoff)
		time.Sleep(backoff)
	}
}

func runConnection(host, credential string, deviceInfo *DeviceInfo, fingerprint map[string]any, sessions *ptyManager) error {
	wsURL, err := normalizeServerURL(host, "ws", "/agents/register")
	if err != nil {
		return fmt.Errorf("invalid control server host: %w", err)
	}

	// The credential goes in a header, never the URL.
	header := http.Header{}
	header.Set("Authorization", "Bearer "+credential)

	rawConn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		return fmt.Errorf("failed to connect to %s: %w%s", wsURL, err, responseDetail(resp))
	}
	log.Printf("connected to control server at %s", wsURL)

	hello := AgentMessage{
		Type:         "hello",
		AgentID:      deviceInfo.DeviceID,
		AgentVersion: getAgentVersion(),
		Fingerprint:  fingerprint,
	}
	if err := rawConn.WriteJSON(hello); err != nil {
		rawConn.Close()
		return fmt.Errorf("handshake failed: %w", err)
	}

	var ack ControlMessage
	if err := rawConn.ReadJSON(&ack); err != nil {
		rawConn.Close()
		return fmt.Errorf("no handshake response: %w", err)
	}

	// Connecting with an auth key enrols the machine; the server hands back a
	// device key to use from now on, so the auth key is never needed again.
	if ack.Type == "enrolled" && ack.DeviceKey != "" {
		deviceInfo.DeviceKey = ack.DeviceKey
		if err := saveDeviceInfo(*deviceInfo); err != nil {
			log.Printf("warning: could not persist device key: %v", err)
		} else {
			log.Printf("enrolled successfully; device key stored")
		}
		if err := rawConn.ReadJSON(&ack); err != nil {
			rawConn.Close()
			return fmt.Errorf("no handshake response after enrollment: %w", err)
		}
	}

	if ack.Type != "hello" {
		rawConn.Close()
		return fmt.Errorf("unexpected handshake response %q", ack.Type)
	}

	conn := newSafeConn(rawConn)
	defer conn.close()

	errCh := make(chan error, 3)
	startPTY := func(session *ptySession) {
		go readFromPTY(conn, session, sessions, errCh)
	}

	// Re-attach whatever this process was already running, so a dropped link
	// does not lose live sessions. Nothing is created here: which session to
	// open is the user's choice now, made in the UI, and creating one eagerly
	// would litter every host with an unwanted session on each reconnect.
	if active := sessions.activeSessions(); len(active) > 0 {
		log.Printf("re-attaching %d existing session(s)", len(active))
		for _, s := range active {
			s.reset()
			startPTY(s)
		}
	}

	// Tell the server what is attachable as soon as the link is up, so the UI
	// can show the picker without waiting for a round trip.
	if err := sendSessions(conn, sessions); err != nil {
		return fmt.Errorf("failed to send session list: %w", err)
	}

	go readFromControl(conn, sessions, errCh, startPTY)
	go sendHeartbeats(conn, errCh)

	return <-errCh
}

// responseDetail summarizes a failed handshake response without echoing the
// request URL, which would put the credential-bearing request back in the log.
func responseDetail(resp *http.Response) string {
	if resp == nil {
		return ""
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
	if len(body) == 0 {
		return fmt.Sprintf(" (HTTP %s)", resp.Status)
	}
	return fmt.Sprintf(" (HTTP %s: %s)", resp.Status, body)
}

func nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > 30*time.Second {
		return 30 * time.Second
	}
	return next
}
