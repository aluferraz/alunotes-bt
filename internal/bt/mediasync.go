package bt

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
)

const (
	bluezMediaPlayer = "org.bluez.MediaPlayer1"

	// MPRIS D-Bus names and interfaces.
	mprisBusName     = "org.mpris.MediaPlayer2.alunotes_bridge"
	mprisObjPath     = "/org/mpris/MediaPlayer2"
	mprisRoot        = "org.mpris.MediaPlayer2"
	mprisPlayerIface = "org.mpris.MediaPlayer2.Player"
)

// AVRCPSync keeps volume and media controls in sync between a phone and
// headphone connected through the Pi.
type AVRCPSync struct {
	sysConn      *dbus.Conn // system bus (BlueZ)
	phoneMAC     string
	headphoneMAC string
	phonePath    string // e.g. /org/bluez/hci0
	hpPath       string // e.g. /org/bluez/hci1
	phoneDevice  dbus.ObjectPath
	log          *slog.Logger
}

// mprisPlayer receives MPRIS method calls (Play, Pause, etc.) from the
// session bus and forwards them to the phone's BlueZ MediaPlayer1.
type mprisPlayer struct {
	sync *AVRCPSync
	log  *slog.Logger
}

// mprisRoot implements the org.mpris.MediaPlayer2 base interface.
type mprisRootObj struct{}

func NewAVRCPSync(conn *dbus.Conn, phoneMAC, headphoneMAC string, sinkPath, sourcePath dbus.ObjectPath, log *slog.Logger) *AVRCPSync {
	phoneEscaped := strings.ReplaceAll(phoneMAC, ":", "_")
	return &AVRCPSync{
		sysConn:      conn,
		phoneMAC:     phoneMAC,
		headphoneMAC: headphoneMAC,
		phonePath:    string(sinkPath),
		hpPath:       string(sourcePath),
		phoneDevice:  dbus.ObjectPath(string(sinkPath) + "/dev_" + phoneEscaped),
		log:          log.With("component", "bt.avrcp"),
	}
}

func (s *AVRCPSync) Run(ctx context.Context) {
	s.log.Info("starting AVRCP sync",
		"phoneDevice", s.phoneDevice,
		"phonePath", s.phonePath,
		"hpPath", s.hpPath,
	)

	// Register MPRIS player on the session bus so PipeWire/mpris-proxy
	// routes headphone AVRCP commands to us.
	if err := s.registerMPRIS(); err != nil {
		s.log.Error("failed to register MPRIS player", "error", err)
	} else {
		s.log.Info("MPRIS player registered on session bus", "name", mprisBusName)
	}

	// Watch BlueZ system bus for volume changes.
	matchRule := "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'"
	s.sysConn.BusObject().Call("org.freedesktop.DBus.AddMatch", 0, matchRule)

	sigCh := make(chan *dbus.Signal, 64)
	s.sysConn.Signal(sigCh)
	defer s.sysConn.RemoveSignal(sigCh)

	for {
		select {
		case <-ctx.Done():
			return
		case sig := <-sigCh:
			s.handleVolumeSignal(sig)
		}
	}
}

// registerMPRIS creates an MPRIS MediaPlayer2 on the session D-Bus.
// When the headphone sends AVRCP play/pause/next, PipeWire routes the
// command to the active MPRIS player — which is us.
func (s *AVRCPSync) registerMPRIS() error {
	sessionConn, err := dbus.SessionBus()
	if err != nil {
		return err
	}

	player := &mprisPlayer{sync: s, log: s.log}
	root := &mprisRootObj{}

	// Export the Player interface.
	if err := sessionConn.Export(player, mprisObjPath, mprisPlayerIface); err != nil {
		return err
	}

	// Export the root MediaPlayer2 interface.
	if err := sessionConn.Export(root, mprisObjPath, mprisRoot); err != nil {
		return err
	}

	// Export properties.
	props := &mprisProps{
		rootProps: map[string]dbus.Variant{
			"CanQuit":             dbus.MakeVariant(false),
			"CanRaise":           dbus.MakeVariant(false),
			"HasTrackList":       dbus.MakeVariant(false),
			"Identity":           dbus.MakeVariant("AluNotes Bridge"),
			"SupportedUriSchemes": dbus.MakeVariant([]string{}),
			"SupportedMimeTypes":  dbus.MakeVariant([]string{}),
		},
		playerProps: map[string]dbus.Variant{
			// Report Playing so mpris-proxy treats us as the active player
			// and routes AVRCP PAUSE/PLAY_PAUSE passthrough events here
			// instead of letting them fall through to the system-level
			// media-key handler (which was waking the host's monitor when
			// the user pressed pause on the headphones).
			"PlaybackStatus": dbus.MakeVariant("Playing"),
			"LoopStatus":     dbus.MakeVariant("None"),
			"Rate":           dbus.MakeVariant(1.0),
			"Shuffle":        dbus.MakeVariant(false),
			"Volume":         dbus.MakeVariant(1.0),
			"Position":       dbus.MakeVariant(int64(0)),
			"MinimumRate":    dbus.MakeVariant(1.0),
			"MaximumRate":    dbus.MakeVariant(1.0),
			"CanGoNext":      dbus.MakeVariant(true),
			"CanGoPrevious":  dbus.MakeVariant(true),
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

	// Export introspection.
	node := &introspect.Node{
		Name: mprisObjPath,
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			{
				Name: mprisRoot,
				Methods: []introspect.Method{
					{Name: "Raise"},
					{Name: "Quit"},
				},
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

	// Claim the MPRIS bus name. AVRCPSync.Run gets re-invoked each time a
	// phone re-connects and reuses the cached session bus, so RequestName
	// can return AlreadyOwner — that is not a failure.
	reply, err := sessionConn.RequestName(mprisBusName, dbus.NameFlagDoNotQueue)
	if err != nil {
		return err
	}
	if reply != dbus.RequestNameReplyPrimaryOwner && reply != dbus.RequestNameReplyAlreadyOwner {
		return fmt.Errorf("could not claim %s (reply=%d)", mprisBusName, reply)
	}

	return nil
}

// forwardToPhone calls a method on the phone's BlueZ MediaPlayer1 and logs
// the phone Status before/after so we can verify the AVRCP passthrough
// actually reached the phone.
func (s *AVRCPSync) forwardToPhone(method string) {
	playerPath := s.findPhonePlayer()
	if playerPath == "" {
		s.log.Warn("no phone player found", "method", method)
		return
	}

	player := s.sysConn.Object(bluezBus, dbus.ObjectPath(playerPath))

	statusBefore := ""
	if sv, err := player.GetProperty(bluezMediaPlayer + ".Status"); err == nil {
		if v, ok := sv.Value().(string); ok {
			statusBefore = v
		}
	}

	call := player.Call(bluezMediaPlayer+"."+method, 0)
	if call.Err != nil {
		s.log.Error("failed to forward to phone",
			"method", method,
			"player", playerPath,
			"statusBefore", statusBefore,
			"error", call.Err,
		)
		return
	}

	s.log.Info("forwarded to phone",
		"method", method,
		"player", playerPath,
		"statusBefore", statusBefore,
	)

	// Verify: re-read Status after a short settle window. If it didn't move,
	// the phone didn't act on our command (AVRCP may have been dropped).
	go func(want string) {
		time.Sleep(500 * time.Millisecond)
		sv, err := player.GetProperty(bluezMediaPlayer + ".Status")
		if err != nil {
			s.log.Warn("status re-read failed", "method", method, "error", err)
			return
		}
		statusAfter, _ := sv.Value().(string)
		s.log.Info("phone status after forward",
			"method", method,
			"statusBefore", statusBefore,
			"statusAfter", statusAfter,
		)
	}(method)
}

func (s *AVRCPSync) findPhonePlayer() string {
	objManager := s.sysConn.Object(bluezBus, "/")
	var managed map[dbus.ObjectPath]map[string]map[string]dbus.Variant
	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managed); err != nil {
		return ""
	}
	prefix := string(s.phoneDevice) + "/"
	for path, ifaces := range managed {
		if strings.HasPrefix(string(path), prefix) {
			if _, ok := ifaces[bluezMediaPlayer]; ok {
				return string(path)
			}
		}
	}
	return ""
}

// MPRIS Player method implementations — called from session bus.

func (p *mprisPlayer) Play() *dbus.Error {
	// AirPods sends Play for both play and pause actions.
	// Toggle based on the phone's actual state.
	p.log.Info("MPRIS Play received from headphone")
	p.toggle()
	return nil
}

func (p *mprisPlayer) Pause() *dbus.Error {
	p.log.Info("MPRIS Pause received from headphone")
	p.sync.forwardToPhone("Pause")
	return nil
}

func (p *mprisPlayer) PlayPause() *dbus.Error {
	p.log.Info("MPRIS PlayPause received from headphone")
	p.toggle()
	return nil
}

func (p *mprisPlayer) toggle() {
	playerPath := p.sync.findPhonePlayer()
	if playerPath != "" {
		player := p.sync.sysConn.Object(bluezBus, dbus.ObjectPath(playerPath))
		statusVar, err := player.GetProperty(bluezMediaPlayer + ".Status")
		if err == nil {
			if status, ok := statusVar.Value().(string); ok {
				if status == "playing" {
					p.sync.forwardToPhone("Pause")
				} else {
					p.sync.forwardToPhone("Play")
				}
				return
			}
		}
	}
	p.sync.forwardToPhone("Play")
}

func (p *mprisPlayer) Next() *dbus.Error {
	p.log.Info("MPRIS Next received from headphone")
	p.sync.forwardToPhone("Next")
	return nil
}

func (p *mprisPlayer) Previous() *dbus.Error {
	p.log.Info("MPRIS Previous received from headphone")
	p.sync.forwardToPhone("Previous")
	return nil
}

func (p *mprisPlayer) Stop() *dbus.Error {
	p.log.Info("MPRIS Stop received from headphone")
	p.sync.forwardToPhone("Stop")
	return nil
}

func (p *mprisPlayer) Seek(offset int64) *dbus.Error {
	return nil
}

func (p *mprisPlayer) SetPosition(trackId dbus.ObjectPath, position int64) *dbus.Error {
	return nil
}

func (p *mprisPlayer) OpenUri(uri string) *dbus.Error {
	return nil
}

// MPRIS root methods.
func (r *mprisRootObj) Raise() *dbus.Error { return nil }
func (r *mprisRootObj) Quit() *dbus.Error  { return nil }

// Volume sync via BlueZ transports.

func (s *AVRCPSync) handleVolumeSignal(sig *dbus.Signal) {
	if sig == nil || sig.Name != "org.freedesktop.DBus.Properties.PropertiesChanged" {
		return
	}
	if len(sig.Body) < 2 {
		return
	}
	iface, _ := sig.Body[0].(string)
	if iface != bluezMediaTrans {
		return
	}
	changed, _ := sig.Body[1].(map[string]dbus.Variant)
	if volVar, ok := changed["Volume"]; ok {
		if vol, ok := volVar.Value().(uint16); ok {
			s.log.Info("incoming volume signal",
				"path", sig.Path,
				"volume", vol,
			)
			s.handleVolumeChange(string(sig.Path), vol)
		}
	}
}

func (s *AVRCPSync) handleVolumeChange(path string, volume uint16) {
	isPhone := strings.HasPrefix(path, s.phonePath)
	isHP := strings.HasPrefix(path, s.hpPath)
	if !isPhone && !isHP {
		return
	}

	targetPrefix := s.hpPath
	if isHP {
		targetPrefix = s.phonePath
	}

	s.setTransportVolumes(targetPrefix, volume)
}

func (s *AVRCPSync) setTransportVolumes(adapterPrefix string, volume uint16) {
	objManager := s.sysConn.Object(bluezBus, "/")
	var managed map[dbus.ObjectPath]map[string]map[string]dbus.Variant
	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managed); err != nil {
		s.log.Warn("volume sync: GetManagedObjects failed", "error", err)
		return
	}
	matched := 0
	for path, ifaces := range managed {
		if !strings.HasPrefix(string(path), adapterPrefix) {
			continue
		}
		if _, ok := ifaces[bluezMediaTrans]; !ok {
			continue
		}
		matched++
		transport := s.sysConn.Object(bluezBus, path)
		call := transport.Call(dbusProperties+".Set", 0,
			bluezMediaTrans, "Volume", dbus.MakeVariant(volume))
		if call.Err != nil {
			s.log.Warn("volume Set rejected by BlueZ",
				"path", path,
				"volume", volume,
				"error", call.Err,
			)
		} else {
			s.log.Info("volume propagated",
				"path", path,
				"volume", volume,
			)
		}
	}
	if matched == 0 {
		s.log.Warn("volume sync: no transport matched prefix",
			"prefix", adapterPrefix,
			"volume", volume,
		)
	}
}

func (s *AVRCPSync) InitialVolumeSync() {
	time.Sleep(2 * time.Second)
	phoneVol := s.getTransportVolume(s.phonePath)
	if phoneVol > 0 {
		s.log.Info("initial volume sync", "phoneVolume", phoneVol)
		s.setTransportVolumes(s.hpPath, phoneVol)
	}
}

func (s *AVRCPSync) getTransportVolume(prefix string) uint16 {
	objManager := s.sysConn.Object(bluezBus, "/")
	var managed map[dbus.ObjectPath]map[string]map[string]dbus.Variant
	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managed); err != nil {
		return 0
	}
	for path, ifaces := range managed {
		if !strings.HasPrefix(string(path), prefix) {
			continue
		}
		if props, ok := ifaces[bluezMediaTrans]; ok {
			if v, ok := props["Volume"]; ok {
				if vol, ok := v.Value().(uint16); ok {
					return vol
				}
			}
		}
	}
	return 0
}

// mprisProps implements org.freedesktop.DBus.Properties for the MPRIS player.
type mprisProps struct {
	rootProps   map[string]dbus.Variant
	playerProps map[string]dbus.Variant
}

func (p *mprisProps) Get(iface, prop string) (dbus.Variant, *dbus.Error) {
	switch iface {
	case mprisRoot:
		if v, ok := p.rootProps[prop]; ok {
			return v, nil
		}
	case mprisPlayerIface:
		if v, ok := p.playerProps[prop]; ok {
			return v, nil
		}
	}
	return dbus.Variant{}, nil
}

func (p *mprisProps) GetAll(iface string) (map[string]dbus.Variant, *dbus.Error) {
	switch iface {
	case mprisRoot:
		return p.rootProps, nil
	case mprisPlayerIface:
		return p.playerProps, nil
	}
	return map[string]dbus.Variant{}, nil
}

func (p *mprisProps) Set(iface, prop string, value dbus.Variant) *dbus.Error {
	switch iface {
	case mprisRoot:
		p.rootProps[prop] = value
	case mprisPlayerIface:
		p.playerProps[prop] = value
	}
	return nil
}
