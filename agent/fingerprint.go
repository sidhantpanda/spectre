package main

import (
	"crypto/sha1"
	"encoding/hex"
	"net"
	"os"
	"strings"
)

func collectFingerprint() map[string]any {
	hostname, _ := os.Hostname()
	machineID := readFileTrim("/etc/machine-id")
	macs, nics := listInterfaces()

	h := sha1.New()
	h.Write([]byte(hostname))
	h.Write([]byte(machineID))
	h.Write([]byte(strings.Join(macs, ",")))
	h.Write([]byte(strings.Join(nics, ",")))
	hash := hex.EncodeToString(h.Sum(nil))

	return map[string]any{
		"hostname":     hostname,
		"machineId":    machineID,
		"macAddresses": macs,
		"nics":         nics,
		"fingerprint":  hash,
	}
}

func readFileTrim(path string) string {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(bytes))
}

func listInterfaces() ([]string, []string) {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil, nil
	}
	macs := []string{}
	nics := []string{}
	for _, iface := range ifs {
		nics = append(nics, iface.Name)
		if len(iface.HardwareAddr) > 0 {
			macs = append(macs, iface.HardwareAddr.String())
		}
	}
	return macs, nics
}
