package main

import (
	"fmt"
	"net"
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
