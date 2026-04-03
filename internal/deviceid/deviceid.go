// Package deviceid generates and persists a unique device identifier.
package deviceid

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	// alphabet is the nanoid-compatible URL-safe alphabet.
	alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	// idLen is the length of the generated ID.
	idLen = 8
	// defaultPath is where the device ID is persisted.
	defaultPath = "/var/lib/alunotes-bridge/device_id"
)

// Resolve returns the device ID, reading it from disk or generating a new one.
// The ID is persisted to filePath so it survives reboots. If filePath is empty,
// defaultPath is used.
func Resolve(filePath string) (string, error) {
	if filePath == "" {
		filePath = defaultPath
	}

	// Try to read existing ID.
	data, err := os.ReadFile(filePath)
	if err == nil {
		id := strings.TrimSpace(string(data))
		if id != "" {
			return id, nil
		}
	}

	// Generate new nanoid.
	id, err := generate()
	if err != nil {
		return "", fmt.Errorf("generating device id: %w", err)
	}

	// Persist it.
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return "", fmt.Errorf("creating device id directory: %w", err)
	}
	if err := os.WriteFile(filePath, []byte(id+"\n"), 0o644); err != nil {
		return "", fmt.Errorf("writing device id: %w", err)
	}

	return id, nil
}

func generate() (string, error) {
	buf := make([]byte, idLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	for i := range buf {
		buf[i] = alphabet[buf[i]%byte(len(alphabet))]
	}
	return string(buf), nil
}
