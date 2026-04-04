// Package pw manages PipeWire audio routing for Bluetooth bridging.
package pw

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"time"
)

// LinkBluetooth creates PipeWire links to route audio from a Bluetooth source
// device to a Bluetooth sink device. This replaces the direct BlueZ transport
// forwarding — PipeWire handles codec encode/decode transparently.
func LinkBluetooth(ctx context.Context, sourceMAC, sinkMAC string, log *slog.Logger) error {
	srcEscaped := strings.ReplaceAll(sourceMAC, ":", "_")
	sinkEscaped := strings.ReplaceAll(sinkMAC, ":", "_")

	log.Info("linking Bluetooth audio via PipeWire",
		"source", sourceMAC,
		"sink", sinkMAC,
	)

	// Wait for both nodes to appear in PipeWire.
	srcPorts, err := waitForPorts(ctx, srcEscaped, "output", log)
	if err != nil {
		return fmt.Errorf("source ports not found: %w", err)
	}

	sinkPorts, err := waitForPorts(ctx, sinkEscaped, "input", log)
	if err != nil {
		return fmt.Errorf("sink ports not found: %w", err)
	}

	// Link each output port to the corresponding input port.
	// Typically FL→playback_FL and FR→playback_FR for stereo.
	for i := 0; i < len(srcPorts) && i < len(sinkPorts); i++ {
		cmd := exec.CommandContext(ctx, "pw-link", srcPorts[i], sinkPorts[i])
		out, err := cmd.CombinedOutput()
		if err != nil {
			// "File exists" means already linked — that's fine.
			if strings.Contains(string(out), "File exists") {
				log.Debug("ports already linked", "src", srcPorts[i], "sink", sinkPorts[i])
				continue
			}
			return fmt.Errorf("pw-link %s → %s: %s: %w", srcPorts[i], sinkPorts[i], string(out), err)
		}
		log.Info("linked PipeWire ports", "src", srcPorts[i], "sink", sinkPorts[i])
	}

	return nil
}

// UnlinkBluetooth removes PipeWire links between two Bluetooth devices.
func UnlinkBluetooth(ctx context.Context, sourceMAC, sinkMAC string, log *slog.Logger) {
	srcEscaped := strings.ReplaceAll(sourceMAC, ":", "_")
	sinkEscaped := strings.ReplaceAll(sinkMAC, ":", "_")

	// List all current links.
	out, err := exec.CommandContext(ctx, "pw-link", "--links").Output()
	if err != nil {
		return
	}

	// Find and disconnect links between our devices.
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, srcEscaped) || strings.Contains(line, sinkEscaped) {
			// pw-link -d <output> <input>
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				exec.CommandContext(ctx, "pw-link", "-d", parts[0], parts[len(parts)-1]).Run()
			}
		}
	}

	log.Info("unlinked PipeWire Bluetooth audio", "source", sourceMAC, "sink", sinkMAC)
}

// waitForPorts discovers PipeWire ports for a Bluetooth device, retrying
// for up to 10 seconds since PipeWire may take time to create them.
func waitForPorts(ctx context.Context, escapedMAC, direction string, log *slog.Logger) ([]string, error) {
	// direction is "output" (for source devices) or "input" (for sink devices)
	flag := "-o"
	if direction == "input" {
		flag = "-i"
	}

	for i := 0; i < 20; i++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		out, err := exec.CommandContext(ctx, "pw-link", flag).Output()
		if err != nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}

		var ports []string
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, escapedMAC) {
				ports = append(ports, line)
			}
		}

		if len(ports) > 0 {
			log.Info("found PipeWire ports",
				"device", escapedMAC,
				"direction", direction,
				"ports", ports,
			)
			return ports, nil
		}

		time.Sleep(500 * time.Millisecond)
	}

	return nil, fmt.Errorf("no %s ports found for %s after 10s", direction, escapedMAC)
}
