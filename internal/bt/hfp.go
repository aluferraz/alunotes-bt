// HFP call control forwarding.
//
// When a phone call is active, headphone button presses (via AVRCP) need to
// reach the phone as call control commands (answer, hang up). The existing
// AVRCPSync MPRIS player runs on the A2DP pipeline context and may be
// unavailable during calls because the A2DP transport goes idle when HFP
// activates.
//
// HFPCallControl registers a separate, persistent MPRIS player on the session
// bus that outlives A2DP transport changes. During calls it forwards headphone
// AVRCP commands to the phone's BlueZ MediaPlayer1 — most phone OSes interpret
// AVRCP Play/Pause as answer/hangup during active calls.
package bt

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
)

const (
	hfpMPRISBusName = "org.mpris.MediaPlayer2.alunotes_call"
)

// CallStateChecker reports whether an HFP call is active.
// Satisfied by pw.HFPRouter.
type CallStateChecker interface {
	InCall() bool
}

// HFPCallControl registers a persistent MPRIS player for call-aware AVRCP
// forwarding. When a call is active, headphone button presses are forwarded
// to the phone as call controls. When no call is active, commands are ignored
// (the main AVRCPSync handler takes care of media controls).
type HFPCallControl struct {
	sysConn     *dbus.Conn
	phoneMAC    string
	sinkPath    string
	phoneDevice dbus.ObjectPath
	callState   CallStateChecker
	log         *slog.Logger
}

// NewHFPCallControl creates a call control forwarder.
func NewHFPCallControl(
	sysConn *dbus.Conn,
	phoneMAC string,
	sinkPath dbus.ObjectPath,
	callState CallStateChecker,
	log *slog.Logger,
) *HFPCallControl {
	phoneEscaped := strings.ReplaceAll(phoneMAC, ":", "_")
	return &HFPCallControl{
		sysConn:     sysConn,
		phoneMAC:    phoneMAC,
		sinkPath:    string(sinkPath),
		phoneDevice: dbus.ObjectPath(string(sinkPath) + "/dev_" + phoneEscaped),
		callState:   callState,
		log:         log.With("component", "bt.hfp"),
	}
}

// Run registers the call-control MPRIS player and blocks until ctx is cancelled.
func (c *HFPCallControl) Run(ctx context.Context) {
	c.log.Info("starting HFP call control MPRIS handler")

	if err := c.registerMPRIS(); err != nil {
		c.log.Error("failed to register call control MPRIS", "error", err)
		return
	}

	c.log.Info("call control MPRIS registered", "name", hfpMPRISBusName)

	<-ctx.Done()
	c.log.Info("HFP call control stopped")
}

func (c *HFPCallControl) registerMPRIS() error {
	sessionConn, err := dbus.SessionBus()
	if err != nil {
		return err
	}

	player := &hfpMPRISPlayer{ctrl: c, log: c.log}
	root := &mprisRootObj{}

	if err := sessionConn.Export(player, mprisObjPath, mprisPlayerIface); err != nil {
		return err
	}
	if err := sessionConn.Export(root, mprisObjPath, mprisRoot); err != nil {
		return err
	}

	// Export properties — report as "paused" so media players take priority.
	props := &mprisProps{
		rootProps: map[string]dbus.Variant{
			"CanQuit":             dbus.MakeVariant(false),
			"CanRaise":            dbus.MakeVariant(false),
			"HasTrackList":        dbus.MakeVariant(false),
			"Identity":            dbus.MakeVariant("AluNotes Call Control"),
			"SupportedUriSchemes": dbus.MakeVariant([]string{}),
			"SupportedMimeTypes":  dbus.MakeVariant([]string{}),
		},
		playerProps: map[string]dbus.Variant{
			"PlaybackStatus": dbus.MakeVariant("Paused"),
			"LoopStatus":     dbus.MakeVariant("None"),
			"Rate":           dbus.MakeVariant(1.0),
			"Shuffle":        dbus.MakeVariant(false),
			"Volume":         dbus.MakeVariant(1.0),
			"Position":       dbus.MakeVariant(int64(0)),
			"MinimumRate":    dbus.MakeVariant(1.0),
			"MaximumRate":    dbus.MakeVariant(1.0),
			"CanGoNext":      dbus.MakeVariant(false),
			"CanGoPrevious":  dbus.MakeVariant(false),
			"CanPlay":        dbus.MakeVariant(true),
			"CanPause":       dbus.MakeVariant(true),
			"CanSeek":        dbus.MakeVariant(false),
			"CanControl":     dbus.MakeVariant(true),
			"Metadata": dbus.MakeVariant(map[string]dbus.Variant{
				"mpris:trackid": dbus.MakeVariant(dbus.ObjectPath("/org/mpris/MediaPlayer2/Track/0")),
			}),
		},
	}
	if err := sessionConn.Export(props, mprisObjPath, "org.freedesktop.DBus.Properties"); err != nil {
		return err
	}

	node := &introspect.Node{
		Name: mprisObjPath,
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			{
				Name:    mprisRoot,
				Methods: []introspect.Method{{Name: "Raise"}, {Name: "Quit"}},
			},
			{
				Name: mprisPlayerIface,
				Methods: []introspect.Method{
					{Name: "Next"},
					{Name: "Previous"},
					{Name: "Pause"},
					{Name: "PlayPause"},
					{Name: "Stop"},
					{Name: "Play"},
					{Name: "Seek", Args: []introspect.Arg{{Name: "Offset", Type: "x", Direction: "in"}}},
					{Name: "SetPosition", Args: []introspect.Arg{
						{Name: "TrackId", Type: "o", Direction: "in"},
						{Name: "Position", Type: "x", Direction: "in"},
					}},
					{Name: "OpenUri", Args: []introspect.Arg{{Name: "Uri", Type: "s", Direction: "in"}}},
				},
			},
		},
	}
	if err := sessionConn.Export(introspect.NewIntrospectable(node), mprisObjPath, "org.freedesktop.DBus.Introspectable"); err != nil {
		return err
	}

	reply, err := sessionConn.RequestName(hfpMPRISBusName, dbus.NameFlagDoNotQueue)
	if err != nil {
		return err
	}
	if reply != dbus.RequestNameReplyPrimaryOwner {
		return fmt.Errorf("could not claim %s", hfpMPRISBusName)
	}

	return nil
}

// forwardToPhone sends a media command to the phone's BlueZ MediaPlayer1.
// During active calls most phone OSes interpret Play as "answer" and Pause
// as "hang up" when received from a Bluetooth headset.
func (c *HFPCallControl) forwardToPhone(method string) {
	playerPath := c.findPhonePlayer()
	if playerPath == "" {
		c.log.Warn("no phone player found for call control", "method", method)
		return
	}

	player := c.sysConn.Object(bluezBus, dbus.ObjectPath(playerPath))
	call := player.Call(bluezMediaPlayer+"."+method, 0)
	if call.Err != nil {
		c.log.Error("call control forward failed", "method", method, "error", call.Err)
	} else {
		c.log.Info("call control forwarded to phone", "method", method)
	}
}

func (c *HFPCallControl) findPhonePlayer() string {
	objManager := c.sysConn.Object(bluezBus, "/")
	var managed map[dbus.ObjectPath]map[string]map[string]dbus.Variant
	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managed); err != nil {
		return ""
	}
	prefix := string(c.phoneDevice) + "/"
	for path, ifaces := range managed {
		if strings.HasPrefix(string(path), prefix) {
			if _, ok := ifaces[bluezMediaPlayer]; ok {
				return string(path)
			}
		}
	}
	return ""
}

// hfpMPRISPlayer handles MPRIS commands with call awareness.
// During calls: forwards Play/Pause as call answer/hangup.
// Outside calls: no-op (the main AVRCPSync handles media).
type hfpMPRISPlayer struct {
	ctrl *HFPCallControl
	log  *slog.Logger
}

func (p *hfpMPRISPlayer) Play() *dbus.Error {
	if !p.ctrl.callState.InCall() {
		return nil
	}
	p.log.Info("headphone Play during call — forwarding as answer/resume")
	p.ctrl.forwardToPhone("Play")
	return nil
}

func (p *hfpMPRISPlayer) Pause() *dbus.Error {
	if !p.ctrl.callState.InCall() {
		return nil
	}
	p.log.Info("headphone Pause during call — forwarding as hangup")
	p.ctrl.forwardToPhone("Pause")
	return nil
}

func (p *hfpMPRISPlayer) PlayPause() *dbus.Error {
	if !p.ctrl.callState.InCall() {
		return nil
	}
	p.log.Info("headphone PlayPause during call — toggling")
	// During a call, Play/Pause toggle: if ringing → answer, if active → hangup.
	p.ctrl.forwardToPhone("Play")
	return nil
}

func (p *hfpMPRISPlayer) Next() *dbus.Error     { return nil }
func (p *hfpMPRISPlayer) Previous() *dbus.Error  { return nil }
func (p *hfpMPRISPlayer) Stop() *dbus.Error      { return nil }
func (p *hfpMPRISPlayer) Seek(offset int64) *dbus.Error { //nolint:govet
	_ = offset
	return nil
}
func (p *hfpMPRISPlayer) SetPosition(_ dbus.ObjectPath, _ int64) *dbus.Error {
	return nil
}
func (p *hfpMPRISPlayer) OpenUri(_ string) *dbus.Error { return nil }
