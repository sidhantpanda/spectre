//go:build !windows

package main

import "syscall"

func detectDiskUsage() (uint64, uint64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		// Statfs_t field types vary across Unixes (Bavail is int64 on BSDs and
		// uint64 on Linux), so convert explicitly rather than relying on them
		// lining up.
		blockSize := uint64(stat.Bsize)
		total := uint64(stat.Blocks) * blockSize
		free := uint64(stat.Bavail) * blockSize
		return total, free
	}
	return 0, 0
}
