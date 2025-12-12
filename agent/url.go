package main

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// buildConnectionURL returns a usable WebSocket URL for the control server to dial.
func buildConnectionURL(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return fmt.Sprintf("ws://%s/ws", strings.TrimPrefix(listen, ":"))
	}

	if host == "" || host == "0.0.0.0" || host == "::" {
		if ip := guessLocalIPv4(); ip != "" {
			host = ip
		} else {
			host = "localhost"
		}
	}
	return fmt.Sprintf("ws://%s:%s/ws", host, port)
}

func guessLocalIPv4() string {
	ifs, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifs {
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok {
				ip := ipnet.IP.To4()
				if ip != nil && !ip.IsLoopback() {
					return ip.String()
				}
			}
		}
	}
	return ""
}

// buildControlServerURL normalizes a control server address into a WebSocket URL
// the agent can proactively connect to. If no path is provided, it defaults to
// /agents/register and appends the token as a query parameter.
func buildControlServerURL(host string, token string) (string, error) {
	u, err := url.Parse(host)
	if err != nil {
		return "", err
	}

	if u.Scheme == "" {
		u.Scheme = "ws"
		u.Host = host
	}

	if u.Scheme == "http" {
		u.Scheme = "ws"
	}
	if u.Scheme == "https" {
		u.Scheme = "wss"
	}

	if u.Path == "" || u.Path == "/" {
		u.Path = "/agents/register"
	}

	q := u.Query()
	if q.Get("token") == "" {
		q.Set("token", token)
	}
	u.RawQuery = q.Encode()

	return u.String(), nil
}
