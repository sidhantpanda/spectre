package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// listDockerContainers returns the running containers and any exposed ports.
// It uses `docker ps` to avoid adding dependencies or needing the Docker daemon SDK.
func listDockerContainers() ([]DockerContainer, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "docker", "ps", "--format", "{{json .}}")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		return nil, fmt.Errorf("docker ps failed: %s", detail)
	}

	containers := make([]DockerContainer, 0)
	scanner := bufio.NewScanner(bytes.NewReader(stdout.Bytes()))
	for scanner.Scan() {
		line := scanner.Bytes()
		var row struct {
			Names string `json:"Names"`
			Ports string `json:"Ports"`
		}
		if err := json.Unmarshal(line, &row); err != nil {
			// Ignore malformed rows so one bad line does not break the response.
			continue
		}
		container := DockerContainer{
			Name: row.Names,
		}
		for _, rawPort := range strings.Split(row.Ports, ",") {
			port := strings.TrimSpace(rawPort)
			if port != "" {
				container.Ports = append(container.Ports, port)
			}
		}
		containers = append(containers, container)
	}
	if err := scanner.Err(); err != nil {
		return containers, err
	}

	return containers, nil
}
