package main

import (
	"net"
)

// collectNetworkInfo enumerates IPv4/IPv6 addresses for non-loopback interfaces.
func collectNetworkInfo() NetworkInfo {
	var ipv4 []string
	var ipv6 []string

	ifaces, err := net.Interfaces()
	if err != nil {
		return NetworkInfo{}
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP
			if ip == nil || ip.IsLoopback() {
				continue
			}
			if ip.To4() != nil {
				ipv4 = append(ipv4, ip.String())
			} else if ip.To16() != nil {
				ipv6 = append(ipv6, ip.String())
			}
		}
	}

	return NetworkInfo{IPv4: ipv4, IPv6: ipv6}
}
