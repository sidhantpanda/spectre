package main

import (
	"fmt"
	"sync"
	"time"
)

var agentVersion string
var agentVersionOnce sync.Once

func getAgentVersion() string {
	agentVersionOnce.Do(func() {
		if agentVersion == "" {
			agentVersion = fmt.Sprintf("dev-%d", time.Now().UTC().Unix())
		}
	})
	return agentVersion
}
