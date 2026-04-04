// Package logging provides pretty console and rotated file logging for slog.
package logging

import (
	"context"
	"log/slog"
	"os"
	"runtime"
	"sync"
)

// ANSI color codes.
const (
	colorReset  = "\033[0m"
	colorDim    = "\033[90m" // gray/dim
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorRed    = "\033[31m"
)

// ConsoleHandler writes human-friendly colored log lines to os.Stdout.
type ConsoleHandler struct {
	mu    sync.Mutex
	level slog.Leveler
	attrs []slog.Attr
	group string
}

// NewConsoleHandler creates a pretty-printing console handler.
func NewConsoleHandler(level slog.Leveler) *ConsoleHandler {
	return &ConsoleHandler{level: level}
}

func (h *ConsoleHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level.Level()
}

func (h *ConsoleHandler) Handle(_ context.Context, r slog.Record) error {
	var color, label string
	switch {
	case r.Level >= slog.LevelError:
		color, label = colorRed, "ERR"
	case r.Level >= slog.LevelWarn:
		color, label = colorYellow, "WRN"
	case r.Level >= slog.LevelInfo:
		color, label = colorGreen, "INF"
	default:
		color, label = colorDim, "DBG"
	}

	t := r.Time.Format("15:04:05")

	// Build the line: "15:04:05 INF message key=val key=val\n"
	buf := make([]byte, 0, 256)
	buf = append(buf, colorDim...)
	buf = append(buf, t...)
	buf = append(buf, colorReset...)
	buf = append(buf, ' ')
	buf = append(buf, color...)
	buf = append(buf, label...)
	buf = append(buf, colorReset...)
	buf = append(buf, ' ')
	buf = append(buf, r.Message...)

	// Pre-set attrs from WithAttrs.
	for _, a := range h.attrs {
		buf = appendAttr(buf, h.group, a)
	}

	// Record attrs.
	r.Attrs(func(a slog.Attr) bool {
		buf = appendAttr(buf, h.group, a)
		return true
	})

	buf = append(buf, '\n')

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := os.Stdout.Write(buf)
	return err
}

func appendAttr(buf []byte, group string, a slog.Attr) []byte {
	if a.Equal(slog.Attr{}) {
		return buf
	}
	buf = append(buf, ' ')
	buf = append(buf, colorDim...)
	if group != "" {
		buf = append(buf, group...)
		buf = append(buf, '.')
	}
	buf = append(buf, a.Key...)
	buf = append(buf, '=')
	buf = append(buf, colorReset...)
	buf = append(buf, a.Value.String()...)
	return buf
}

func (h *ConsoleHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newAttrs := make([]slog.Attr, len(h.attrs), len(h.attrs)+len(attrs))
	copy(newAttrs, h.attrs)
	newAttrs = append(newAttrs, attrs...)
	return &ConsoleHandler{level: h.level, attrs: newAttrs, group: h.group}
}

func (h *ConsoleHandler) WithGroup(name string) slog.Handler {
	g := name
	if h.group != "" {
		g = h.group + "." + name
	}
	newAttrs := make([]slog.Attr, len(h.attrs))
	copy(newAttrs, h.attrs)
	return &ConsoleHandler{level: h.level, attrs: newAttrs, group: g}
}

// MultiHandler fans out log records to multiple handlers.
type MultiHandler struct {
	handlers []slog.Handler
}

// NewMultiHandler creates a handler that writes to all given handlers.
func NewMultiHandler(handlers ...slog.Handler) *MultiHandler {
	return &MultiHandler{handlers: handlers}
}

func (m *MultiHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, h := range m.handlers {
		if h.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (m *MultiHandler) Handle(ctx context.Context, r slog.Record) error {
	var firstErr error
	for _, h := range m.handlers {
		if h.Enabled(ctx, r.Level) {
			if err := h.Handle(ctx, r); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func (m *MultiHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	handlers := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		handlers[i] = h.WithAttrs(attrs)
	}
	return &MultiHandler{handlers: handlers}
}

func (m *MultiHandler) WithGroup(name string) slog.Handler {
	handlers := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		handlers[i] = h.WithGroup(name)
	}
	return &MultiHandler{handlers: handlers}
}

// Options configures the logging setup.
type Options struct {
	Level   slog.Level
	LogDir  string // directory for log files (e.g. "logs")
	LogFile string // base filename (e.g. "bridge.log")
}

// Setup creates a logger with both console (pretty) and file (JSON) handlers.
// If the file logger cannot be created, it falls back to console-only and
// prints a warning.
func Setup(opts Options) *slog.Logger {
	consoleHandler := NewConsoleHandler(&opts.Level)

	if opts.LogDir == "" || opts.LogFile == "" {
		return slog.New(consoleHandler)
	}

	fw, err := NewFileWriter(opts.LogDir, opts.LogFile)
	if err != nil {
		logger := slog.New(consoleHandler)
		logger.Warn("failed to open log file, file logging disabled", "error", err)
		return logger
	}

	// Ensure file writer is closed on GC (best-effort).
	runtime.SetFinalizer(fw, func(f *FileWriter) { f.Close() })

	fileHandler := slog.NewJSONHandler(fw, &slog.HandlerOptions{Level: opts.Level})

	return slog.New(NewMultiHandler(consoleHandler, fileHandler))
}
