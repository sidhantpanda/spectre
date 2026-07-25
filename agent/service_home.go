package main

import (
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
)

// State directory for the installed service. Both the unit file and the
// enrollment that runs before it resolve their paths from here. A var so tests
// can point it somewhere writable.
var defaultServiceAgentHome = "/var/lib/spectre-agent"

func purgeDataDirs() {
	dirs := []string{}

	if p, err := deviceInfoPath(); err == nil {
		dirs = append(dirs, filepath.Dir(p))
	}

	sysDir := "/var/lib/spectre-agent"
	if _, err := os.Stat(sysDir); err == nil {
		dirs = append(dirs, sysDir)
	}

	for _, d := range dirs {
		if err := os.RemoveAll(d); err != nil {
			fmt.Printf("  warning: could not remove %s: %v\n", d, err)
		} else {
			fmt.Printf("  removed %s\n", d)
		}
	}
}

// serviceAgentHome is where the installed service keeps its device key. An
// operator-set SPECTRE_AGENT_HOME wins, and is written into the unit so both
// halves keep agreeing.
func serviceAgentHome() string {
	if home := os.Getenv("SPECTRE_AGENT_HOME"); home != "" {
		return home
	}
	return defaultServiceAgentHome
}

// prepareServiceHome points enrollment at the service's state directory, and
// carries over a device key from a previous non-service enrollment so an
// already-enrolled machine is not enrolled all over again.
func prepareServiceHome() error {
	home := serviceAgentHome()
	if os.Getenv("SPECTRE_AGENT_HOME") == home {
		return nil // already resolved to the same place; nothing to move
	}

	existing, err := deviceInfoPath()
	if err != nil {
		existing = "" // no home to migrate from; not fatal
	}

	if err := os.Setenv("SPECTRE_AGENT_HOME", home); err != nil {
		return fmt.Errorf("set agent home: %w", err)
	}
	target, err := deviceInfoPath()
	if err != nil {
		return fmt.Errorf("resolve device info path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(target), err)
	}

	if existing == "" || existing == target {
		return nil
	}
	if _, err := os.Stat(target); err == nil {
		return nil // the service already has its own copy
	}
	data, err := os.ReadFile(existing)
	if err != nil {
		return nil // nothing enrolled here before
	}
	// Copied, not moved: running `spectre-agent run` by hand as that user keeps
	// working, and it is the same device key either way.
	if err := os.WriteFile(target, data, 0o600); err != nil {
		return fmt.Errorf("copy device info to %s: %w", target, err)
	}
	fmt.Printf("Reusing the device key already enrolled on this machine (%s).\n", existing)
	return nil
}

// handServiceHomeToServiceAccount gives the state directory to whoever the
// service runs as. `up` runs under sudo, so everything it just wrote is owned
// by root and would be unreadable to a service running as the invoking user.
func handServiceHomeToServiceAccount() error {
	uid, gid, ok := serviceAccountIDs()
	if !ok {
		return nil // service runs as root; nothing to hand over
	}

	path, err := deviceInfoPath()
	if err != nil {
		return nil
	}
	dir := filepath.Dir(path)
	for _, target := range []string{filepath.Dir(dir), dir, path} {
		if _, err := os.Stat(target); err != nil {
			continue
		}
		if err := os.Chown(target, uid, gid); err != nil {
			return fmt.Errorf("chown %s: %w", target, err)
		}
	}
	return nil
}

func serviceAccountIDs() (int, int, bool) {
	name, _ := resolveServiceAccount()
	if name == "" {
		return 0, 0, false
	}
	u, err := user.Lookup(name)
	if err != nil {
		return 0, 0, false
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return 0, 0, false
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return 0, 0, false
	}
	return uid, gid, true
}

// enrollForService makes sure this machine holds a device key before the
// service is installed, so the service itself starts with no secret on its
// command line. An already-enrolled machine is left alone.
func enrollForService(host, authKey string) error {
	info, err := ensureDeviceInfo()
	if err != nil {
		return fmt.Errorf("read device info: %w", err)
	}
	if info.DeviceKey != "" {
		fmt.Println("This machine is already enrolled.")
		return nil
	}

	if authKey != "" {
		fmt.Println("Enrolling with control server...")
		key, err := enrollWithAuthKey(host, authKey, info.DeviceID)
		if err != nil {
			return fmt.Errorf("enrollment failed: %w", err)
		}
		info.DeviceKey = key
	} else {
		key, err := enrollInteractively(host, info.DeviceID)
		if err != nil {
			return err
		}
		info.DeviceKey = key
	}

	if err := saveDeviceInfo(info); err != nil {
		return fmt.Errorf("store device key: %w", err)
	}
	fmt.Println("Enrolled. Device key stored.")
	return nil
}
