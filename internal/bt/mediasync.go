package bt

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	bluezMediaPlayer = "org.bluez.MediaPlayer1"
)

// AVRCPSync forwards AVRCP media commands from the headphone to the phone's
// media player via BlueZ D-Bus. It also monitors volume changes on BlueZ
// MediaTransport1 and keeps them in sync between both devices.
type AVRCPSync struct {
	conn         *dbus.Conn
	phoneDevice  dbus.ObjectPath
	phonePath    string // adapter prefix for phone (e.g. /org/bluez/hci0)
	hpPath       string // adapter prefix for headphone (e.g. /org/bluez/hci1)
	log          *slog.Logger
}

// NewAVRCPSync creates a new AVRCP synchronization service.
func NewAVRCPSync(conn *dbus.Conn, phoneMAC, headphoneMAC string, sinkAdapterPath, sourceAdapterPath dbus.ObjectPath, log *slog.Logger) *AVRCPSync {
	phoneEscaped := strings.ReplaceAll(phoneMAC, ":", "_")
	phoneDev := dbus.ObjectPath(string(sinkAdapterPath) + "/dev_" + phoneEscaped)

	return &AVRCPSync{
		conn:        conn,
		phoneDevice: phoneDev,
		phonePath:   string(sinkAdapterPath),
		hpPath:      string(sourceAdapterPath),
		log:         log.With("component", "bt.avrcp"),
	}
}

// Run watches for AVRCP events from the headphone and forwards them to the
// phone. Also syncs BlueZ transport volumes. Blocks until ctx is cancelled.
func (s *AVRCPSync) Run(ctx context.Context) {
	s.log.Info("starting AVRCP sync", "phoneDevice", s.phoneDevice)

	// Subscribe to BlueZ signals for media events.
	matchRule := "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'"
	s.conn.BusObject().Call("org.freedesktop.DBus.AddMatch", 0, matchRule)

	sigCh := make(chan *dbus.Signal, 32)
	s.conn.Signal(sigCh)
	defer s.conn.RemoveSignal(sigCh)

	for {
		select {
		case <-ctx.Done():
			return
		case sig := <-sigCh:
			s.handleSignal(sig)
		}
	}
}

func (s *AVRCPSync) handleSignal(sig *dbus.Signal) {
	if sig == nil || sig.Name != "org.freedesktop.DBus.Properties.PropertiesChanged" {
		return
	}
	if len(sig.Body) < 2 {
		return
	}

	iface, _ := sig.Body[0].(string)
	changed, _ := sig.Body[1].(map[string]dbus.Variant)
	path := string(sig.Path)

	switch iface {
	case bluezMediaTrans:
		// Volume change on a transport.
		if volVar, ok := changed["Volume"]; ok {
			vol, ok := volVar.Value().(uint16)
			if !ok {
				return
			}
			s.handleVolumeChange(path, vol)
		}

	case bluezMediaPlayer:
		// Media player status change (from phone).
		if statusVar, ok := changed["Status"]; ok {
			status, _ := statusVar.Value().(string)
			s.log.Debug("phone player status changed", "status", status)
		}
	}
}

// handleVolumeChange syncs volume between phone and headphone transports.
// BlueZ A2DP volume is 0-127.
func (s *AVRCPSync) handleVolumeChange(transportPath string, volume uint16) {
	isPhone := strings.HasPrefix(transportPath, s.phonePath)
	isHP := strings.HasPrefix(transportPath, s.hpPath)

	if !isPhone && !isHP {
		return
	}

	direction := "phone→headphone"
	targetPrefix := s.hpPath
	if isHP {
		direction = "headphone→phone"
		targetPrefix = s.phonePath
	}

	s.log.Info("volume change detected",
		"direction", direction,
		"volume", volume,
		"path", transportPath,
	)

	// Find all transports under the target adapter and set their volume.
	s.setTransportVolumes(targetPrefix, volume)
}

// setTransportVolumes sets the Volume property on all MediaTransport1 objects
// under the given adapter path prefix.
func (s *AVRCPSync) setTransportVolumes(adapterPrefix string, volume uint16) {
	objManager := s.conn.Object(bluezBus, "/")
	var managedObjects map[dbus.ObjectPath]map[string]map[string]dbus.Variant

	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managedObjects); err != nil {
		return
	}

	for path, ifaces := range managedObjects {
		pathStr := string(path)
		if !strings.HasPrefix(pathStr, adapterPrefix) {
			continue
		}
		if _, ok := ifaces[bluezMediaTrans]; !ok {
			continue
		}

		transport := s.conn.Object(bluezBus, path)
		call := transport.Call(dbusProperties+".Set", 0,
			bluezMediaTrans, "Volume", dbus.MakeVariant(volume))
		if call.Err != nil {
			s.log.Debug("failed to set transport volume", "path", path, "error", call.Err)
		} else {
			s.log.Debug("set transport volume", "path", path, "volume", volume)
		}
	}
}

// ForwardCommand sends an AVRCP command to the phone's media player.
// command is one of: "Play", "Pause", "Next", "Previous", "Stop".
func (s *AVRCPSync) ForwardCommand(command string) error {
	// Find the phone's MediaPlayer1 object (usually at .../player0).
	playerPath := s.findPhonePlayer()
	if playerPath == "" {
		return fmt.Errorf("no media player found on phone device")
	}

	player := s.conn.Object(bluezBus, dbus.ObjectPath(playerPath))
	call := player.Call(bluezMediaPlayer+"."+command, 0)
	if call.Err != nil {
		return call.Err
	}

	s.log.Info("forwarded AVRCP command", "command", command, "player", playerPath)
	return nil
}

// findPhonePlayer looks for a MediaPlayer1 object under the phone's device.
func (s *AVRCPSync) findPhonePlayer() string {
	objManager := s.conn.Object(bluezBus, "/")
	var managedObjects map[dbus.ObjectPath]map[string]map[string]dbus.Variant

	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managedObjects); err != nil {
		return ""
	}

	phonePrefix := string(s.phoneDevice) + "/"
	for path, ifaces := range managedObjects {
		pathStr := string(path)
		if strings.HasPrefix(pathStr, phonePrefix) {
			if _, ok := ifaces[bluezMediaPlayer]; ok {
				return pathStr
			}
		}
	}

	return ""
}

// InitialVolumeSync reads the phone's transport volume and applies it to
// the headphone. Call this once both devices are connected.
func (s *AVRCPSync) InitialVolumeSync() {
	// Small delay to let transports settle.
	time.Sleep(2 * time.Second)

	phoneVol := s.getTransportVolume(s.phonePath)
	if phoneVol >= 0 {
		s.log.Info("initial volume sync", "phoneVolume", phoneVol)
		s.setTransportVolumes(s.hpPath, phoneVol)
	}
}

// getTransportVolume reads the Volume from the first MediaTransport1 under an adapter.
func (s *AVRCPSync) getTransportVolume(adapterPrefix string) uint16 {
	objManager := s.conn.Object(bluezBus, "/")
	var managedObjects map[dbus.ObjectPath]map[string]map[string]dbus.Variant

	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managedObjects); err != nil {
		return 0
	}

	for path, ifaces := range managedObjects {
		pathStr := string(path)
		if !strings.HasPrefix(pathStr, adapterPrefix) {
			continue
		}
		if transProps, ok := ifaces[bluezMediaTrans]; ok {
			if volVar, ok := transProps["Volume"]; ok {
				if vol, ok := volVar.Value().(uint16); ok {
					return vol
				}
			}
		}
	}

	return 0
}
