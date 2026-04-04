package audio

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/aluferraz/alunotes-bt/internal/session"
)

// PipeWireCapture records audio from PipeWire via pw-cat directly to WAV files.
// PipeWire handles all A2DP codec negotiation and decoding (SBC, AAC, LDAC,
// aptX, Samsung Scalable, etc.), giving us clean audio regardless of codec.
type PipeWireCapture struct {
	sessMgr *session.Manager
	log     *slog.Logger
}

// NewPipeWireCapture creates a new PipeWire capture stage.
func NewPipeWireCapture(sessMgr *session.Manager, log *slog.Logger) *PipeWireCapture {
	return &PipeWireCapture{
		sessMgr: sessMgr,
		log:     log.With("component", "audio.pwcapture"),
	}
}

// Run finds the PipeWire node for the given Bluetooth device, creates a
// recording session, and launches pw-cat to record directly to a WAV file.
// It blocks until done is closed or the capture process exits.
func (c *PipeWireCapture) Run(ctx context.Context, deviceMAC string, rate, channels, bitDepth int, done <-chan struct{}) {
	c.log.Info("waiting for PipeWire Bluetooth node", "mac", deviceMAC)

	escapedMAC := strings.ReplaceAll(deviceMAC, ":", "_")

	target, err := c.findNode(ctx, escapedMAC)
	if err != nil {
		c.log.Error("could not find PipeWire node", "mac", deviceMAC, "error", err)
		return
	}
	c.log.Info("found PipeWire node", "target", target)

	// Create a recording session.
	sess, err := c.sessMgr.Touch()
	if err != nil {
		c.log.Error("failed to create session", "error", err)
		return
	}

	wavPath := filepath.Join(sess.Dir, fmt.Sprintf("recording-%s.wav", nanoid()))
	c.log.Info("recording to", "path", wavPath)

	// pw-cat --record writes a proper WAV file directly.
	format := fmt.Sprintf("s%d", bitDepth)
	cmd := exec.CommandContext(ctx, "pw-cat", "--record",
		fmt.Sprintf("--target=%s", target),
		fmt.Sprintf("--format=%s", format),
		fmt.Sprintf("--rate=%d", rate),
		fmt.Sprintf("--channels=%d", channels),
		"--latency=256",
		wavPath,
	)

	if err := cmd.Start(); err != nil {
		c.log.Error("failed to start pw-cat", "error", err)
		return
	}

	c.log.Info("pw-cat recording started",
		"target", target,
		"path", wavPath,
		"rate", rate,
		"channels", channels,
		"bitDepth", bitDepth,
	)

	// Keep the session alive while recording.
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	waitCh := make(chan error, 1)
	go func() { waitCh <- cmd.Wait() }()

	for {
		select {
		case <-done:
			cmd.Process.Signal(os.Interrupt)
			select {
			case <-waitCh:
			case <-time.After(3 * time.Second):
				cmd.Process.Kill()
			}
			c.logFileSize(wavPath)
			c.log.Info("capture stopped")
			return
		case err := <-waitCh:
			if err != nil {
				c.log.Info("pw-cat exited", "error", err)
			}
			c.logFileSize(wavPath)
			return
		case <-ticker.C:
			// Touch the session to prevent idle timeout while recording.
			c.sessMgr.Touch()
		}
	}
}

func (c *PipeWireCapture) logFileSize(path string) {
	if info, err := os.Stat(path); err == nil {
		c.log.Info("recording complete", "path", path, "size", info.Size())
	}
}

// findNode discovers the PipeWire node name for a Bluetooth device.
func (c *PipeWireCapture) findNode(ctx context.Context, escapedMAC string) (string, error) {
	for i := 0; i < 20; i++ {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}

		out, err := exec.CommandContext(ctx, "pw-cli", "list-objects").Output()
		if err != nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}

		lines := strings.Split(string(out), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.Contains(line, escapedMAC) &&
				strings.Contains(line, "node.name") &&
				(strings.Contains(line, "bluez_input") || strings.Contains(line, "bluez_output") || strings.Contains(line, "bluez_source")) &&
				!strings.Contains(line, "capture_internal") {
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					name := strings.TrimSpace(parts[1])
					name = strings.Trim(name, "\"")
					return name, nil
				}
			}
		}

		time.Sleep(500 * time.Millisecond)
	}

	return "", fmt.Errorf("no PipeWire node found for device %s after 10s", escapedMAC)
}
