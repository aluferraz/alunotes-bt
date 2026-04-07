// Package session manages recording session lifecycle with idle detection.
//
// A session begins when audio data first arrives and ends after a configurable
// period of silence (no audio above the silence threshold).
package session

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/aluferraz/alunotes-bt/internal/config"
)

// Session represents a single recording session with its own output directory.
type Session struct {
	ID        string
	Dir       string
	StartedAt time.Time

	mu        sync.Mutex
	lastAudio time.Time
	closed    bool
}

// Manager creates and tracks sessions, handling idle timeout detection.
type Manager struct {
	cfg     config.SessionConfig
	storage config.StorageConfig
	log     *slog.Logger

	mu         sync.Mutex
	current    *Session
	autoRecord bool           // when false, Touch() won't start new sessions
	onEnd      func(*Session) // callback when session ends
}

// NewManager creates a new session Manager.
func NewManager(sessionCfg config.SessionConfig, storageCfg config.StorageConfig, logger *slog.Logger) *Manager {
	return &Manager{
		cfg:        sessionCfg,
		storage:    storageCfg,
		log:        logger.With("component", "session"),
		autoRecord: true,
	}
}

// AutoRecord returns whether auto-recording is enabled.
func (m *Manager) AutoRecord() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.autoRecord
}

// SetAutoRecord enables or disables automatic session creation on audio arrival.
// When disabled, Touch() will not start new sessions (but existing ones continue).
func (m *Manager) SetAutoRecord(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.autoRecord = enabled
	m.log.Info("auto-record toggled", "enabled", enabled)
}

// Stop immediately ends the current session (if any), flushing the recording to disk.
// This is the same as an idle timeout firing but triggered manually.
func (m *Manager) Stop() {
	m.endCurrentSession()
}

// OnSessionEnd sets a callback invoked when a session ends due to idle timeout.
func (m *Manager) OnSessionEnd(fn func(*Session)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onEnd = fn
}

// Current returns the active session, or nil if none.
func (m *Manager) Current() *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current
}

// Touch signals that audio activity occurred, starting a new session if needed.
// Returns the current session, or nil if auto-record is disabled and no session is active.
func (m *Manager) Touch() (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()

	if m.current != nil && !m.current.closed {
		m.current.mu.Lock()
		m.current.lastAudio = now
		m.current.mu.Unlock()
		return m.current, nil
	}

	// Don't start a new session if auto-record is off.
	if !m.autoRecord {
		return nil, nil
	}

	// Start a new session.
	sess, err := m.newSession(now)
	if err != nil {
		return nil, err
	}
	m.current = sess
	m.log.Info("session started", "id", sess.ID, "dir", sess.Dir)
	return sess, nil
}

// RunIdleWatcher periodically checks if the current session has gone idle.
// It blocks until the context-provided done channel is closed.
func (m *Manager) RunIdleWatcher(done <-chan struct{}) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			m.endCurrentSession()
			return
		case <-ticker.C:
			m.checkIdle()
		}
	}
}

func (m *Manager) checkIdle() {
	m.mu.Lock()
	sess := m.current
	m.mu.Unlock()

	if sess == nil || sess.closed {
		return
	}

	sess.mu.Lock()
	idle := time.Since(sess.lastAudio)
	sess.mu.Unlock()

	if idle >= m.cfg.IdleTimeout {
		m.log.Info("session idle timeout", "id", sess.ID, "idle", idle.Round(time.Second))
		m.endCurrentSession()
	}
}

func (m *Manager) endCurrentSession() {
	m.mu.Lock()
	sess := m.current
	callback := m.onEnd
	m.mu.Unlock()

	if sess == nil || sess.closed {
		return
	}

	sess.mu.Lock()
	sess.closed = true
	sess.mu.Unlock()

	m.log.Info("session ended", "id", sess.ID, "duration", time.Since(sess.StartedAt).Round(time.Second))

	if callback != nil {
		callback(sess)
	}

	m.mu.Lock()
	m.current = nil
	m.mu.Unlock()
}

func (m *Manager) newSession(now time.Time) (*Session, error) {
	dateDir := now.Format("2006-01-02")
	timeDir := now.Format("15-04-05")
	dir := filepath.Join(m.storage.BaseDir, dateDir, timeDir)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating session directory: %w", err)
	}

	return &Session{
		ID:        fmt.Sprintf("%s/%s", dateDir, timeDir),
		Dir:       dir,
		StartedAt: now,
		lastAudio: now,
	}, nil
}
