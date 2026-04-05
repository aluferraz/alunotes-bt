// HFP call audio routing and recording via PipeWire.
//
// When a phone call activates HFP (Hands-Free Profile), PipeWire switches the
// phone's Bluetooth card from A2DP to headset-head-unit, creating mono SCO
// audio nodes. This router detects that transition, switches the headphone to
// HFP mode as well, and creates bidirectional PipeWire links so call audio
// flows: phone speaker → headphone ear, headphone mic → phone caller.
//
// Call audio is also recorded to WAV via pw-cat.
//
// When the call ends the phone switches back to A2DP automatically. The router
// detects the disappearance of mono ports, restores the headphone to A2DP, and
// the existing A2DP pipeline restarts via the normal transport watcher.
package pw

import (
	"bufio"
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aluferraz/alunotes-bt/internal/session"
)

// HFPRouter monitors PipeWire for HFP call activation on the phone and manages
// bidirectional SCO audio routing between the phone and headphone.
type HFPRouter struct {
	phoneMAC     string
	headphoneMAC string
	sessMgr      *session.Manager
	log          *slog.Logger

	mu         sync.Mutex
	inCall     bool
	callCancel context.CancelFunc // cancels call-scoped goroutines (recording)
}

// NewHFPRouter creates a new HFP call audio router.
func NewHFPRouter(phoneMAC, headphoneMAC string, sessMgr *session.Manager, log *slog.Logger) *HFPRouter {
	return &HFPRouter{
		phoneMAC:     phoneMAC,
		headphoneMAC: headphoneMAC,
		sessMgr:      sessMgr,
		log:          log.With("component", "pw.hfp"),
	}
}

// InCall reports whether an HFP call is currently active.
func (r *HFPRouter) InCall() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.inCall
}

// Run monitors PipeWire for HFP call events via pactl subscribe.
// It blocks until ctx is cancelled.
func (r *HFPRouter) Run(ctx context.Context) {
	r.log.Info("starting HFP call audio router",
		"phone", r.phoneMAC,
		"headphone", r.headphoneMAC,
	)

	// Let PipeWire finish setting up device nodes after BT connection.
	select {
	case <-ctx.Done():
		return
	case <-time.After(2 * time.Second):
	}

	cmd := exec.CommandContext(ctx, "pactl", "subscribe")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		r.log.Error("failed to pipe pactl subscribe", "error", err)
		return
	}
	if err := cmd.Start(); err != nil {
		r.log.Error("failed to start pactl subscribe", "error", err)
		return
	}

	r.log.Info("monitoring PipeWire for HFP call events")

	var lastCheck time.Time
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			cmd.Process.Kill()
			cmd.Wait()
			if r.InCall() {
				r.endCall(context.Background())
			}
			return
		default:
		}

		line := scanner.Text()

		// React to card profile changes and node lifecycle events.
		if !strings.Contains(line, "'change'") &&
			!strings.Contains(line, "'new'") &&
			!strings.Contains(line, "'remove'") {
			continue
		}

		// Debounce — avoid hammering pw-link for rapid-fire events.
		if time.Since(lastCheck) < 300*time.Millisecond {
			continue
		}
		lastCheck = time.Now()

		r.checkCallState(ctx)
	}

	cmd.Wait()
}

// checkCallState checks the phone's PipeWire card profile to determine
// whether an HFP call is active. We check the card profile rather than
// looking for MONO ports because the phone may have HFP nodes registered
// alongside A2DP even when no call is happening.
func (r *HFPRouter) checkCallState(ctx context.Context) {
	phoneInHFP := isCardInHFP(ctx, r.phoneMAC)
	wasInCall := r.InCall()

	if phoneInHFP && !wasInCall {
		r.startCall(ctx)
	} else if !phoneInHFP && wasInCall {
		r.endCall(ctx)
	}
}

// isCardInHFP checks whether a Bluetooth device's PipeWire card is currently
// using an HFP/HSP profile (headset-head-unit). This is the authoritative
// indicator of an active call — unlike MONO port checks, it ignores idle HFP
// nodes that BlueZ keeps registered alongside A2DP.
func isCardInHFP(ctx context.Context, mac string) bool {
	escaped := strings.ReplaceAll(mac, ":", "_")
	cardName := "bluez_card." + escaped

	out, err := exec.CommandContext(ctx, "pactl", "list", "cards").Output()
	if err != nil {
		return false
	}

	inCard := false
	for _, line := range strings.Split(string(out), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, cardName) {
			inCard = true
		}
		if inCard && strings.HasPrefix(trimmed, "Active Profile:") {
			profile := strings.TrimSpace(strings.TrimPrefix(trimmed, "Active Profile:"))
			return strings.HasPrefix(profile, "headset-head-unit")
		}
	}
	return false
}

// startCall switches the headphone to HFP mode, creates bidirectional SCO
// audio links, and begins recording call audio.
func (r *HFPRouter) startCall(ctx context.Context) {
	r.mu.Lock()
	if r.inCall {
		r.mu.Unlock()
		return
	}
	r.inCall = true
	callCtx, cancel := context.WithCancel(ctx)
	r.callCancel = cancel
	r.mu.Unlock()

	r.log.Info("HFP call detected, routing call audio to headphone",
		"phone", r.phoneMAC,
		"headphone", r.headphoneMAC,
	)

	// Switch headphone from A2DP to HFP so it exposes mono SCO ports.
	if err := SwitchCardProfile(ctx, r.headphoneMAC, true, r.log); err != nil {
		r.log.Error("failed to switch headphone to HFP", "error", err)
	}

	// Link bidirectional SCO audio.
	if err := LinkHFP(ctx, r.phoneMAC, r.headphoneMAC, r.log); err != nil {
		r.log.Error("failed to link HFP call audio", "error", err)
	}

	// Record call audio in the background.
	if r.sessMgr != nil {
		go r.recordCall(callCtx)
	}
}

// endCall stops recording, restores the headphone to A2DP mode. PipeWire
// automatically tears down links when the HFP nodes are destroyed.
func (r *HFPRouter) endCall(ctx context.Context) {
	r.mu.Lock()
	if !r.inCall {
		r.mu.Unlock()
		return
	}
	r.inCall = false
	if r.callCancel != nil {
		r.callCancel()
		r.callCancel = nil
	}
	r.mu.Unlock()

	r.log.Info("HFP call ended, restoring headphone A2DP",
		"phone", r.phoneMAC,
		"headphone", r.headphoneMAC,
	)

	if err := SwitchCardProfile(ctx, r.headphoneMAC, false, r.log); err != nil {
		r.log.Error("failed to restore headphone A2DP profile", "error", err)
	}
}

// recordCall captures full-duplex call audio — both the phone's outgoing
// audio (caller's voice) and the headphone mic (user's voice) — mixed into
// a single WAV file.
//
// It creates a PipeWire null-sink as a mixer, links both HFP output streams
// into it, and records from the mixer's monitor source. If the mixer can't
// be created it falls back to recording the phone side only.
func (r *HFPRouter) recordCall(callCtx context.Context) {
	phoneEscaped := strings.ReplaceAll(r.phoneMAC, ":", "_")
	hpEscaped := strings.ReplaceAll(r.headphoneMAC, ":", "_")

	// Create a virtual null-sink that sums both call directions.
	moduleID, err := loadCallMixer(callCtx, r.log)
	if err != nil {
		r.log.Warn("failed to create call mixer, falling back to single-direction recording", "error", err)
		r.recordSingleStream(callCtx, phoneEscaped)
		return
	}
	defer unloadCallMixer(context.Background(), moduleID, r.log)

	// Wait for mixer sink input ports to appear.
	mixerIn, err := waitForNamedPorts(callCtx, callMixSinkName, "input", r.log)
	if err != nil {
		r.log.Warn("mixer input ports not found, falling back", "error", err)
		r.recordSingleStream(callCtx, phoneEscaped)
		return
	}

	// Link phone HFP output (caller's voice) → mixer.
	phoneOut, _ := waitForMonoPorts(callCtx, phoneEscaped, "output", r.log)
	for _, src := range phoneOut {
		for _, sink := range mixerIn {
			pwLink(callCtx, src, sink, "phone->mixer", r.log)
		}
	}

	// Link headphone HFP output (user's mic) → mixer.
	hpOut, _ := waitForMonoPorts(callCtx, hpEscaped, "output", r.log)
	for _, src := range hpOut {
		for _, sink := range mixerIn {
			pwLink(callCtx, src, sink, "hp mic->mixer", r.log)
		}
	}

	// Find the mixer's monitor source node for recording.
	monitorTarget := callMixSinkName + ".monitor"
	if found, err := findPWNode(callCtx, monitorTarget, r.log); err == nil {
		monitorTarget = found
	}

	r.runPWCatRecord(callCtx, monitorTarget)
}

// recordSingleStream is the fallback: records just the phone's HFP output
// (caller's voice) when the full-duplex mixer can't be created.
func (r *HFPRouter) recordSingleStream(callCtx context.Context, phoneEscapedMAC string) {
	target, err := findHFPNode(callCtx, phoneEscapedMAC, r.log)
	if err != nil {
		r.log.Error("could not find HFP node for call recording", "error", err)
		return
	}
	r.runPWCatRecord(callCtx, target)
}

// runPWCatRecord starts pw-cat recording from the given PipeWire target and
// blocks until callCtx is cancelled (call ends) or the process exits.
func (r *HFPRouter) runPWCatRecord(callCtx context.Context, target string) {
	sess, err := r.sessMgr.Touch()
	if err != nil {
		r.log.Error("failed to create session for call recording", "error", err)
		return
	}

	wavPath := filepath.Join(sess.Dir, fmt.Sprintf("call-%s.wav", hfpNanoid()))
	r.log.Info("recording call audio", "path", wavPath, "target", target)

	// HFP audio is 16 kHz mono (mSBC) or 8 kHz mono (CVSD).
	// Use 16 kHz — PipeWire resamples if the source is 8 kHz.
	cmd := exec.CommandContext(callCtx, "pw-cat", "--record",
		fmt.Sprintf("--target=%s", target),
		"--format=s16",
		"--rate=16000",
		"--channels=1",
		"--latency=256",
		wavPath,
	)

	if err := cmd.Start(); err != nil {
		r.log.Error("failed to start call recording", "error", err)
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	waitCh := make(chan error, 1)
	go func() { waitCh <- cmd.Wait() }()

	for {
		select {
		case <-callCtx.Done():
			cmd.Process.Signal(os.Interrupt)
			select {
			case <-waitCh:
			case <-time.After(3 * time.Second):
				cmd.Process.Kill()
			}
			r.logCallRecording(wavPath)
			return
		case err := <-waitCh:
			if err != nil {
				r.log.Info("call recording pw-cat exited", "error", err)
			}
			r.logCallRecording(wavPath)
			return
		case <-ticker.C:
			r.sessMgr.Touch()
		}
	}
}

// --- Call mixer (PipeWire null-sink for full-duplex mixing) ---

const callMixSinkName = "alunotes_call_mix"

// loadCallMixer creates a PipeWire null-sink that acts as a mixing point for
// both call directions. Returns the module ID for cleanup.
func loadCallMixer(ctx context.Context, log *slog.Logger) (string, error) {
	out, err := exec.CommandContext(ctx, "pactl", "load-module", "module-null-sink",
		"sink_name="+callMixSinkName,
		"rate=16000",
		"channels=1",
		"channel_map=mono",
	).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("pactl load-module: %s: %w", strings.TrimSpace(string(out)), err)
	}
	moduleID := strings.TrimSpace(string(out))
	log.Info("call mixer loaded", "moduleID", moduleID, "sink", callMixSinkName)
	return moduleID, nil
}

// unloadCallMixer removes the null-sink module.
func unloadCallMixer(ctx context.Context, moduleID string, log *slog.Logger) {
	if out, err := exec.CommandContext(ctx, "pactl", "unload-module", moduleID).CombinedOutput(); err != nil {
		log.Warn("failed to unload call mixer", "moduleID", moduleID, "error", strings.TrimSpace(string(out)))
	} else {
		log.Info("call mixer unloaded", "moduleID", moduleID)
	}
}

// waitForNamedPorts discovers PipeWire ports matching a node name prefix.
func waitForNamedPorts(ctx context.Context, namePrefix, direction string, log *slog.Logger) ([]string, error) {
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
			if strings.Contains(line, namePrefix) {
				ports = append(ports, line)
			}
		}

		if len(ports) > 0 {
			log.Info("found named ports",
				"prefix", namePrefix,
				"direction", direction,
				"ports", ports,
			)
			return ports, nil
		}

		time.Sleep(500 * time.Millisecond)
	}

	return nil, fmt.Errorf("no %s ports for %q after 10s", direction, namePrefix)
}

// findPWNode looks up a PipeWire node by name via pw-cli.
func findPWNode(ctx context.Context, name string, log *slog.Logger) (string, error) {
	for i := 0; i < 10; i++ {
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
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, name) && strings.Contains(line, "node.name") {
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					found := strings.Trim(strings.TrimSpace(parts[1]), "\"")
					return found, nil
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return "", fmt.Errorf("PipeWire node %q not found", name)
}

func (r *HFPRouter) logCallRecording(path string) {
	if info, err := os.Stat(path); err == nil {
		r.log.Info("call recording complete", "path", path, "size", info.Size())
	}
}

// findHFPNode discovers the PipeWire node name for a Bluetooth device's HFP
// audio stream. HFP nodes have "MONO" ports (as opposed to stereo A2DP).
func findHFPNode(ctx context.Context, escapedMAC string, log *slog.Logger) (string, error) {
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
				(strings.Contains(line, "bluez_input") || strings.Contains(line, "bluez_source")) {
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					name := strings.Trim(strings.TrimSpace(parts[1]), "\"")
					log.Info("found HFP node", "node", name)
					return name, nil
				}
			}
		}

		time.Sleep(500 * time.Millisecond)
	}

	return "", fmt.Errorf("no HFP PipeWire node for %s after 10s", escapedMAC)
}

func hfpNanoid() string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[b[i]%byte(len(alphabet))]
	}
	return string(b)
}

// SwitchCardProfile changes a Bluetooth device's PipeWire card profile between
// A2DP and HFP/HSP. For HFP it tries mSBC (wideband 16 kHz) first, then falls
// back to CVSD (narrowband 8 kHz).
func SwitchCardProfile(ctx context.Context, mac string, toHFP bool, log *slog.Logger) error {
	escaped := strings.ReplaceAll(mac, ":", "_")
	cardName := "bluez_card." + escaped

	var profiles []string
	if toHFP {
		// "headset-head-unit" is mSBC on PipeWire 1.x (highest priority).
		// Naming varies across PipeWire versions so we try all known variants.
		profiles = []string{
			"headset-head-unit",
			"headset-head-unit-msbc",
			"headset-head-unit-cvsd",
		}
	} else {
		profiles = []string{
			"a2dp-sink",
			"a2dp-sink-sbc",
			"a2dp-sink-sbc_xq",
			"a2dp-sink-aac",
		}
	}

	for _, profile := range profiles {
		log.Info("switching card profile", "card", cardName, "profile", profile)
		out, err := exec.CommandContext(ctx, "pactl", "set-card-profile", cardName, profile).CombinedOutput()
		if err == nil {
			log.Info("card profile switched", "card", cardName, "profile", profile)
			return nil
		}
		log.Debug("profile switch failed",
			"card", cardName,
			"profile", profile,
			"output", strings.TrimSpace(string(out)),
		)
	}

	return fmt.Errorf("no suitable profile for %s (hfp=%v)", cardName, toHFP)
}

// LinkHFP creates bidirectional PipeWire links for HFP call audio:
//
//	phone SCO output  → headphone SCO input  (call audio to ear)
//	headphone SCO output → phone SCO input   (microphone to caller)
func LinkHFP(ctx context.Context, phoneMAC, headphoneMAC string, log *slog.Logger) error {
	phoneEscaped := strings.ReplaceAll(phoneMAC, ":", "_")
	hpEscaped := strings.ReplaceAll(headphoneMAC, ":", "_")

	log.Info("linking HFP call audio", "phone", phoneMAC, "headphone", headphoneMAC)

	phoneOut, err := waitForMonoPorts(ctx, phoneEscaped, "output", log)
	if err != nil {
		return fmt.Errorf("phone HFP output ports: %w", err)
	}
	phoneIn, err := waitForMonoPorts(ctx, phoneEscaped, "input", log)
	if err != nil {
		return fmt.Errorf("phone HFP input ports: %w", err)
	}
	hpOut, err := waitForMonoPorts(ctx, hpEscaped, "output", log)
	if err != nil {
		return fmt.Errorf("headphone HFP output ports: %w", err)
	}
	hpIn, err := waitForMonoPorts(ctx, hpEscaped, "input", log)
	if err != nil {
		return fmt.Errorf("headphone HFP input ports: %w", err)
	}

	// Phone call audio → headphone speaker.
	for i := 0; i < len(phoneOut) && i < len(hpIn); i++ {
		pwLink(ctx, phoneOut[i], hpIn[i], "phone->hp speaker", log)
	}

	// Headphone microphone → phone caller.
	for i := 0; i < len(hpOut) && i < len(phoneIn); i++ {
		pwLink(ctx, hpOut[i], phoneIn[i], "hp mic->phone", log)
	}

	log.Info("HFP call audio linked")
	return nil
}

func pwLink(ctx context.Context, src, sink, label string, log *slog.Logger) {
	out, err := exec.CommandContext(ctx, "pw-link", src, sink).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "File exists") {
			log.Debug("already linked", "label", label)
			return
		}
		log.Error("pw-link failed",
			"label", label,
			"src", src,
			"sink", sink,
			"error", strings.TrimSpace(string(out)),
		)
		return
	}
	log.Info("linked HFP ports", "label", label, "src", src, "sink", sink)
}

// waitForMonoPorts discovers mono (HFP/SCO) PipeWire ports for a Bluetooth
// device, retrying for up to 10 seconds while the profile switch completes.
func waitForMonoPorts(ctx context.Context, escapedMAC, direction string, log *slog.Logger) ([]string, error) {
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
			if strings.Contains(line, escapedMAC) && strings.Contains(line, "MONO") {
				ports = append(ports, line)
			}
		}

		if len(ports) > 0 {
			log.Info("found HFP ports",
				"device", escapedMAC,
				"direction", direction,
				"ports", ports,
			)
			return ports, nil
		}

		time.Sleep(500 * time.Millisecond)
	}

	return nil, fmt.Errorf("no HFP %s ports for %s after 10s", direction, escapedMAC)
}
