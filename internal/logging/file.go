package logging

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const (
	defaultMaxSize    = 10 * 1024 * 1024 // 10 MB
	defaultMaxBackups = 5
)

// FileWriter is an io.Writer that writes to a file and rotates it when it
// exceeds a size threshold. It keeps a limited number of backup files.
type FileWriter struct {
	mu         sync.Mutex
	dir        string
	name       string // base filename, e.g. "bridge.log"
	maxSize    int64
	maxBackups int
	file       *os.File
	size       int64
}

// NewFileWriter creates a rotated file writer. It creates the log directory
// if it does not exist and opens (or creates) the log file for appending.
func NewFileWriter(dir, name string) (*FileWriter, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}

	fw := &FileWriter{
		dir:        dir,
		name:       name,
		maxSize:    defaultMaxSize,
		maxBackups: defaultMaxBackups,
	}

	if err := fw.openFile(); err != nil {
		return nil, err
	}
	return fw, nil
}

// Write implements io.Writer. It checks the file size after writing and
// rotates if the threshold is exceeded.
func (fw *FileWriter) Write(p []byte) (int, error) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	// Rotate before writing if the next write would exceed the limit.
	if fw.size+int64(len(p)) > fw.maxSize {
		if err := fw.rotate(); err != nil {
			// If rotation fails, try to write anyway.
			_ = err
		}
	}

	n, err := fw.file.Write(p)
	fw.size += int64(n)
	return n, err
}

// Close closes the underlying file.
func (fw *FileWriter) Close() error {
	fw.mu.Lock()
	defer fw.mu.Unlock()
	if fw.file != nil {
		return fw.file.Close()
	}
	return nil
}

// openFile opens the current log file for append, creating it if needed,
// and records its size.
func (fw *FileWriter) openFile() error {
	path := filepath.Join(fw.dir, fw.name)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}

	info, err := f.Stat()
	if err != nil {
		f.Close()
		return fmt.Errorf("stat log file: %w", err)
	}

	fw.file = f
	fw.size = info.Size()
	return nil
}

// rotate closes the current file and shifts backups:
//
//	bridge.log.4 is deleted
//	bridge.log.3 -> bridge.log.4
//	bridge.log.2 -> bridge.log.3
//	bridge.log.1 -> bridge.log.2
//	bridge.log   -> bridge.log.1
//
// Then a fresh bridge.log is opened.
func (fw *FileWriter) rotate() error {
	if fw.file != nil {
		fw.file.Close()
		fw.file = nil
	}

	basePath := filepath.Join(fw.dir, fw.name)

	// Remove the oldest backup if it exists.
	oldest := fmt.Sprintf("%s.%d", basePath, fw.maxBackups)
	_ = os.Remove(oldest)

	// Shift existing backups up by one.
	for i := fw.maxBackups - 1; i >= 1; i-- {
		src := fmt.Sprintf("%s.%d", basePath, i)
		dst := fmt.Sprintf("%s.%d", basePath, i+1)
		_ = os.Rename(src, dst)
	}

	// Move the current log to .1
	_ = os.Rename(basePath, basePath+".1")

	return fw.openFile()
}
