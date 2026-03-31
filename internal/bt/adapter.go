// Package bt manages Bluetooth connectivity via BlueZ over D-Bus.
//
// It handles adapter configuration, A2DP sink registration (to receive audio
// from phones/laptops), A2DP source connection (to forward audio to real
// headphones), and transport lifecycle management.
package bt

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/godbus/dbus/v5"

	"github.com/aluferraz/alunotes-bt/internal/config"
)

const (
	bluezBus         = "org.bluez"
	bluezAdapter     = "org.bluez.Adapter1"
	bluezDevice      = "org.bluez.Device1"
	bluezMediaTrans  = "org.bluez.MediaTransport1"
	dbusProperties   = "org.freedesktop.DBus.Properties"
	dbusObjectManager = "org.freedesktop.DBus.ObjectManager"
)

// Adapter manages a BlueZ HCI adapter and connected devices.
type Adapter struct {
	cfg      config.BluetoothConfig
	conn     *dbus.Conn
	path     dbus.ObjectPath
	log      *slog.Logger

	mu          sync.Mutex
	sinkDevice  dbus.ObjectPath // inbound device (phone) connected to us
	sourceDevice dbus.ObjectPath // outbound device (real headphone)
}

// NewAdapter creates a new Adapter for the given HCI device.
func NewAdapter(cfg config.BluetoothConfig, logger *slog.Logger) (*Adapter, error) {
	conn, err := dbus.SystemBus()
	if err != nil {
		return nil, fmt.Errorf("connecting to system D-Bus: %w", err)
	}

	path := dbus.ObjectPath("/org/bluez/" + cfg.AdapterName)

	return &Adapter{
		cfg:  cfg,
		conn: conn,
		path: path,
		log:  logger.With("component", "bt.adapter"),
	}, nil
}

// Setup configures the adapter for A2DP sink + source operation.
func (a *Adapter) Setup(ctx context.Context) error {
	a.log.Info("configuring adapter", "adapter", a.cfg.AdapterName)

	adapter := a.conn.Object(bluezBus, a.path)

	// Power on the adapter.
	if err := a.setProperty(adapter, bluezAdapter, "Powered", true); err != nil {
		return fmt.Errorf("powering on adapter: %w", err)
	}

	// Make discoverable so phones can find us.
	if err := a.setProperty(adapter, bluezAdapter, "Discoverable", true); err != nil {
		return fmt.Errorf("setting discoverable: %w", err)
	}

	// Set the friendly name.
	if err := a.setProperty(adapter, bluezAdapter, "Alias", a.cfg.SinkName); err != nil {
		return fmt.Errorf("setting adapter alias: %w", err)
	}

	a.log.Info("adapter configured", "name", a.cfg.SinkName, "discoverable", true)
	return nil
}

// ConnectHeadphone attempts to connect to the target headphone (A2DP source role).
func (a *Adapter) ConnectHeadphone(ctx context.Context) error {
	if a.cfg.TargetHeadphone == "" {
		a.log.Warn("no target headphone configured, skipping outbound connection")
		return nil
	}

	devicePath := a.macToDevicePath(a.cfg.TargetHeadphone)
	device := a.conn.Object(bluezBus, devicePath)

	a.log.Info("connecting to headphone", "mac", a.cfg.TargetHeadphone)

	call := device.CallWithContext(ctx, bluezDevice+".Connect", 0)
	if call.Err != nil {
		return fmt.Errorf("connecting to headphone %s: %w", a.cfg.TargetHeadphone, call.Err)
	}

	a.mu.Lock()
	a.sourceDevice = devicePath
	a.mu.Unlock()

	a.log.Info("headphone connected", "mac", a.cfg.TargetHeadphone)
	return nil
}

// WatchTransports listens for A2DP media transport additions/removals on D-Bus
// and calls the provided callbacks. This blocks until the context is cancelled.
func (a *Adapter) WatchTransports(ctx context.Context, onAcquire func(TransportInfo), onRelease func()) error {
	matchRule := "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',path_namespace='/org/bluez'"
	a.conn.BusObject().Call("org.freedesktop.DBus.AddMatch", 0, matchRule)

	ifaceAddedRule := "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.ObjectManager',member='InterfacesAdded'"
	a.conn.BusObject().Call("org.freedesktop.DBus.AddMatch", 0, ifaceAddedRule)

	ifaceRemovedRule := "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.ObjectManager',member='InterfacesRemoved'"
	a.conn.BusObject().Call("org.freedesktop.DBus.AddMatch", 0, ifaceRemovedRule)

	sigCh := make(chan *dbus.Signal, 32)
	a.conn.Signal(sigCh)
	defer a.conn.RemoveSignal(sigCh)

	a.log.Info("watching for Bluetooth transport events")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case sig := <-sigCh:
			a.handleSignal(sig, onAcquire, onRelease)
		}
	}
}

// TransportInfo holds the details needed to acquire and use an A2DP transport.
type TransportInfo struct {
	Path dbus.ObjectPath
	FD   int
}

// AcquireTransport acquires a media transport, returning the file descriptor
// for reading/writing audio data.
func (a *Adapter) AcquireTransport(path dbus.ObjectPath) (fd int, readMTU uint16, writeMTU uint16, err error) {
	transport := a.conn.Object(bluezBus, path)

	call := transport.Call(bluezMediaTrans+".Acquire", 0)
	if call.Err != nil {
		return 0, 0, 0, fmt.Errorf("acquiring transport %s: %w", path, call.Err)
	}

	if err := call.Store(&fd, &readMTU, &writeMTU); err != nil {
		return 0, 0, 0, fmt.Errorf("reading transport fd: %w", err)
	}

	a.log.Info("transport acquired", "path", path, "fd", fd, "readMTU", readMTU, "writeMTU", writeMTU)
	return fd, readMTU, writeMTU, nil
}

// ReleaseTransport releases a previously acquired media transport.
func (a *Adapter) ReleaseTransport(path dbus.ObjectPath) error {
	transport := a.conn.Object(bluezBus, path)
	call := transport.Call(bluezMediaTrans+".Release", 0)
	if call.Err != nil {
		return fmt.Errorf("releasing transport %s: %w", path, call.Err)
	}
	a.log.Info("transport released", "path", path)
	return nil
}

// Close disconnects from D-Bus.
func (a *Adapter) Close() error {
	return a.conn.Close()
}

func (a *Adapter) setProperty(obj dbus.BusObject, iface, prop string, value interface{}) error {
	call := obj.Call(dbusProperties+".Set", 0, iface, prop, dbus.MakeVariant(value))
	return call.Err
}

func (a *Adapter) macToDevicePath(mac string) dbus.ObjectPath {
	escaped := strings.ReplaceAll(mac, ":", "_")
	return dbus.ObjectPath(fmt.Sprintf("%s/dev_%s", a.path, escaped))
}

func (a *Adapter) handleSignal(sig *dbus.Signal, onAcquire func(TransportInfo), onRelease func()) {
	if sig == nil {
		return
	}

	switch sig.Name {
	case "org.freedesktop.DBus.ObjectManager.InterfacesAdded":
		if len(sig.Body) < 2 {
			return
		}
		path, ok := sig.Body[0].(dbus.ObjectPath)
		if !ok {
			return
		}
		ifaces, ok := sig.Body[1].(map[string]map[string]dbus.Variant)
		if !ok {
			return
		}
		if _, hasTransport := ifaces[bluezMediaTrans]; hasTransport {
			a.log.Info("media transport added", "path", path)
			onAcquire(TransportInfo{Path: path})
		}

	case "org.freedesktop.DBus.ObjectManager.InterfacesRemoved":
		if len(sig.Body) < 2 {
			return
		}
		_, ok := sig.Body[0].(dbus.ObjectPath)
		if !ok {
			return
		}
		ifaces, ok := sig.Body[1].([]string)
		if !ok {
			return
		}
		for _, iface := range ifaces {
			if iface == bluezMediaTrans {
				a.log.Info("media transport removed")
				onRelease()
				return
			}
		}

	case "org.freedesktop.DBus.Properties.PropertiesChanged":
		if len(sig.Body) < 2 {
			return
		}
		iface, ok := sig.Body[0].(string)
		if !ok || iface != bluezMediaTrans {
			return
		}
		changed, ok := sig.Body[1].(map[string]dbus.Variant)
		if !ok {
			return
		}
		if stateVar, ok := changed["State"]; ok {
			state := stateVar.Value().(string)
			a.log.Info("transport state changed", "state", state, "path", sig.Path)
			if state == "pending" || state == "active" {
				onAcquire(TransportInfo{Path: sig.Path})
			} else if state == "idle" {
				onRelease()
			}
		}
	}
}
