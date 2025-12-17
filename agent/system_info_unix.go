//go:build !windows

package main

import "syscall"

func detectDiskUsage() (uint64, uint64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bavail * uint64(stat.Bsize)
		return total, free
	}
	return 0, 0
}
