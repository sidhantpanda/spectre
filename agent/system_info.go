package main

import (
	"bytes"
	"context"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func collectSystemInfo() (SystemInfo, error) {
	info := SystemInfo{
		Arch:  runtime.GOARCH,
		Cores: runtime.NumCPU(),
	}

	info.OS, info.Version = detectOSVersion()
	info.CPU = detectCPUName()
	info.MemoryBytes = detectMemoryBytes()
	info.DiskTotalBytes, info.DiskFreeBytes = detectDiskUsage()

	return info, nil
}

func detectOSVersion() (string, string) {
	switch runtime.GOOS {
	case "linux":
		name, version := parseOSRelease()
		if name != "" || version != "" {
			return name, version
		}
		out := runSimpleCommand("uname", "-sr")
		return "Linux", out
	case "darwin":
		name := strings.TrimSpace(runSimpleCommand("sw_vers", "-productName"))
		version := strings.TrimSpace(runSimpleCommand("sw_vers", "-productVersion"))
		return defaultString(name, "macOS"), version
	case "windows":
		out := runSimpleCommand("wmic", "os", "get", "Caption", "/value")
		parts := strings.Split(strings.TrimSpace(out), "=")
		if len(parts) == 2 {
			return parts[1], ""
		}
		return "Windows", ""
	default:
		return runtime.GOOS, ""
	}
}

func detectCPUName() string {
	switch runtime.GOOS {
	case "linux":
		for _, line := range strings.Split(runSimpleCommand("cat", "/proc/cpuinfo"), "\n") {
			if strings.HasPrefix(strings.ToLower(line), "model name") {
				if parts := strings.SplitN(line, ":", 2); len(parts) == 2 {
					return strings.TrimSpace(parts[1])
				}
			}
		}
	case "darwin":
		if out := runSimpleCommand("sysctl", "-n", "machdep.cpu.brand_string"); out != "" {
			return out
		}
	case "windows":
		out := runSimpleCommand("wmic", "cpu", "get", "Name", "/value")
		parts := strings.Split(strings.TrimSpace(out), "=")
		if len(parts) == 2 {
			return strings.TrimSpace(parts[1])
		}
	}
	return ""
}

func detectMemoryBytes() uint64 {
	switch runtime.GOOS {
	case "linux":
		for _, line := range strings.Split(runSimpleCommand("cat", "/proc/meminfo"), "\n") {
			if strings.HasPrefix(line, "MemTotal:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					if kb, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
						return kb * 1024
					}
				}
			}
		}
	case "darwin":
		if out := runSimpleCommand("sysctl", "-n", "hw.memsize"); out != "" {
			if bytes, err := strconv.ParseUint(strings.TrimSpace(out), 10, 64); err == nil {
				return bytes
			}
		}
	case "windows":
		out := runSimpleCommand("wmic", "OS", "get", "TotalVisibleMemorySize", "/value")
		parts := strings.Split(strings.TrimSpace(out), "=")
		if len(parts) == 2 {
			if kb, err := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 64); err == nil {
				return kb * 1024
			}
		}
	}
	return 0
}

func parseOSRelease() (string, string) {
	content := runSimpleCommand("cat", "/etc/os-release")
	var name, version string
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			name = strings.Trim(line[len("PRETTY_NAME="):], "\"")
		} else if strings.HasPrefix(line, "NAME=") && name == "" {
			name = strings.Trim(line[len("NAME="):], "\"")
		} else if strings.HasPrefix(line, "VERSION=") {
			version = strings.Trim(line[len("VERSION="):], "\"")
		}
	}
	return name, version
}

func runSimpleCommand(name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...) // #nosec G204
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		return ""
	}
	return strings.TrimSpace(buf.String())
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func parseUint(val string) uint64 {
	val = strings.TrimSpace(val)
	num, err := strconv.ParseUint(val, 10, 64)
	if err != nil {
		return 0
	}
	return num
}
