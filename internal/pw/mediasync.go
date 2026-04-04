package pw

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// MediaSync keeps volume and media controls in sync between two Bluetooth
// devices connected through PipeWire. It monitors PipeWire for volume changes
// and forwards AVRCP media commands via BlueZ D-Bus.
type MediaSync struct {
	phoneMAC     string
	headphoneMAC string
	log          *slog.Logger

	mu              sync.Mutex
	phoneNodeID     int
	headphoneNodeID int
	syncing         atomic.Bool // prevents feedback loops during sync
}

// NewMediaSync creates a new media synchronization service.
func NewMediaSync(phoneMAC, headphoneMAC string, log *slog.Logger) *MediaSync {
	return &MediaSync{
		phoneMAC:     phoneMAC,
		headphoneMAC: headphoneMAC,
		log:          log.With("component", "pw.mediasync"),
	}
}

// Run starts volume and media synchronization. Blocks until ctx is cancelled.
func (s *MediaSync) Run(ctx context.Context) {
	s.log.Info("starting media sync",
		"phone", s.phoneMAC,
		"headphone", s.headphoneMAC,
	)

	// Discover PipeWire node IDs for both devices.
	if err := s.discoverNodes(ctx); err != nil {
		s.log.Error("failed to discover PipeWire nodes", "error", err)
		return
	}

	// Initial sync: set headphone volume to match phone.
	s.syncVolume(ctx, "phone")

	// Monitor volume changes via pactl subscribe.
	s.monitorVolumes(ctx)
}

// discoverNodes finds the PipeWire node IDs for both Bluetooth devices.
func (s *MediaSync) discoverNodes(ctx context.Context) error {
	phoneEscaped := strings.ReplaceAll(s.phoneMAC, ":", "_")
	headphoneEscaped := strings.ReplaceAll(s.headphoneMAC, ":", "_")

	for i := 0; i < 20; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		phoneID := findNodeID(ctx, phoneEscaped)
		headphoneID := findNodeID(ctx, headphoneEscaped)

		if phoneID > 0 && headphoneID > 0 {
			s.mu.Lock()
			s.phoneNodeID = phoneID
			s.headphoneNodeID = headphoneID
			s.mu.Unlock()

			s.log.Info("discovered PipeWire nodes",
				"phoneNodeID", phoneID,
				"headphoneNodeID", headphoneID,
			)
			return nil
		}

		time.Sleep(500 * time.Millisecond)
	}

	return fmt.Errorf("could not find PipeWire nodes for both devices")
}

// findNodeID finds the PipeWire object ID for a Bluetooth device.
func findNodeID(ctx context.Context, escapedMAC string) int {
	out, err := exec.CommandContext(ctx, "pw-cli", "list-objects").Output()
	if err != nil {
		return 0
	}

	// Parse pw-cli output looking for a bluez node with this MAC.
	// The object ID is on a line like: 	id 42, type PipeWire:Interface:Node/3, ...
	lines := strings.Split(string(out), "\n")
	currentID := 0
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Track the current object ID.
		if strings.HasPrefix(trimmed, "id ") {
			parts := strings.SplitN(trimmed, ",", 2)
			if len(parts) > 0 {
				idStr := strings.TrimPrefix(parts[0], "id ")
				if id, err := strconv.Atoi(strings.TrimSpace(idStr)); err == nil {
					currentID = id
				}
			}
		}

		// Check if this object's node.name contains our MAC.
		if strings.Contains(trimmed, escapedMAC) &&
			strings.Contains(trimmed, "node.name") &&
			!strings.Contains(trimmed, "capture_internal") &&
			!strings.Contains(trimmed, "midi") {
			return currentID
		}
	}
	return 0
}

// syncVolume reads the volume from one device and sets it on the other.
// direction is "phone" (phone→headphone) or "headphone" (headphone→phone).
func (s *MediaSync) syncVolume(ctx context.Context, direction string) {
	if s.syncing.Load() {
		return
	}
	s.syncing.Store(true)
	defer func() {
		// Small delay before allowing re-sync to avoid loops.
		time.AfterFunc(200*time.Millisecond, func() { s.syncing.Store(false) })
	}()

	s.mu.Lock()
	phoneID := s.phoneNodeID
	headphoneID := s.headphoneNodeID
	s.mu.Unlock()

	if phoneID == 0 || headphoneID == 0 {
		return
	}

	var srcID, dstID int
	if direction == "phone" {
		srcID, dstID = phoneID, headphoneID
	} else {
		srcID, dstID = headphoneID, phoneID
	}

	vol := getVolume(ctx, srcID)
	if vol < 0 {
		return
	}

	setVolume(ctx, dstID, vol)
	s.log.Info("volume synced",
		"direction", direction,
		"volume", fmt.Sprintf("%.0f%%", vol*100),
	)
}

// getVolume reads the volume of a PipeWire node (0.0-1.0+).
func getVolume(ctx context.Context, nodeID int) float64 {
	out, err := exec.CommandContext(ctx, "wpctl", "get-volume", strconv.Itoa(nodeID)).Output()
	if err != nil {
		return -1
	}
	// Output: "Volume: 0.75" or "Volume: 0.75 [MUTED]"
	line := strings.TrimSpace(string(out))
	parts := strings.Fields(line)
	if len(parts) < 2 {
		return -1
	}
	vol, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return -1
	}
	return vol
}

// setVolume sets the volume of a PipeWire node.
func setVolume(ctx context.Context, nodeID int, vol float64) {
	exec.CommandContext(ctx, "wpctl", "set-volume", strconv.Itoa(nodeID),
		fmt.Sprintf("%.4f", vol)).Run()
}

// monitorVolumes uses pactl subscribe to detect volume changes in real-time
// and syncs between devices. Blocks until ctx is cancelled.
func (s *MediaSync) monitorVolumes(ctx context.Context) {
	cmd := exec.CommandContext(ctx, "pactl", "subscribe")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.log.Error("failed to start pactl subscribe", "error", err)
		return
	}
	if err := cmd.Start(); err != nil {
		s.log.Error("failed to start pactl subscribe", "error", err)
		return
	}

	s.log.Info("monitoring PipeWire volume changes")

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			cmd.Process.Kill()
			cmd.Wait()
			return
		default:
		}

		line := scanner.Text()
		// pactl subscribe outputs lines like:
		// Event 'change' on sink #42
		// Event 'change' on source #15
		// Event 'change' on sink-input #7
		if !strings.Contains(line, "'change'") {
			continue
		}
		if !strings.Contains(line, "sink") && !strings.Contains(line, "source") {
			continue
		}

		// A volume change happened. Check both devices and sync if needed.
		s.checkAndSync(ctx)
	}

	cmd.Wait()
}

// checkAndSync reads both volumes and syncs if they differ.
func (s *MediaSync) checkAndSync(ctx context.Context) {
	if s.syncing.Load() {
		return
	}

	s.mu.Lock()
	phoneID := s.phoneNodeID
	headphoneID := s.headphoneNodeID
	s.mu.Unlock()

	if phoneID == 0 || headphoneID == 0 {
		return
	}

	phoneVol := getVolume(ctx, phoneID)
	headphoneVol := getVolume(ctx, headphoneID)

	if phoneVol < 0 || headphoneVol < 0 {
		return
	}

	// Only sync if volumes differ by more than 1%.
	diff := phoneVol - headphoneVol
	if diff < -0.01 || diff > 0.01 {
		// Determine which one changed by comparing to last known state.
		// Simple heuristic: the one that changed most recently is the source.
		// Since we can't easily track "who changed", we'll check which device
		// has a volume different from the other and sync the other to match.
		// Both PipeWire events for sink and source changes come here,
		// so we sync headphone → phone's volume as the default.
		s.syncing.Store(true)
		defer func() {
			time.AfterFunc(300*time.Millisecond, func() { s.syncing.Store(false) })
		}()

		// For now: always sync headphone to phone's volume.
		// Phone volume is authoritative (controlled by the user's phone UI).
		setVolume(ctx, headphoneID, phoneVol)
		s.log.Debug("volume sync", "phoneVol", phoneVol, "headphoneVol", headphoneVol)
	}
}
