// Package bt manages Bluetooth connectivity via BlueZ over D-Bus.
//
// It supports dual-adapter operation: one HCI adapter acts as the A2DP sink
// (receiving audio from phones) and a separate adapter acts as the A2DP source
// (forwarding audio to real headphones). This is required because a single
// Bluetooth radio cannot reliably serve both roles simultaneously.
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
	bluezBus          = "org.bluez"
	bluezAdapter      = "org.bluez.Adapter1"
	bluezDevice       = "org.bluez.Device1"
	bluezMediaTrans   = "org.bluez.MediaTransport1"
	dbusProperties    = "org.freedesktop.DBus.Properties"
	dbusObjectManager = "org.freedesktop.DBus.ObjectManager"
)

// Adapter manages BlueZ HCI adapters and connected devices.
// It supports separate adapters for sink (inbound) and source (outbound) roles.
type Adapter struct {
	cfg        config.BluetoothConfig
	conn       *dbus.Conn
	sinkPath   dbus.ObjectPath // adapter receiving audio (e.g. /org/bluez/hci0)
	sourcePath dbus.ObjectPath // adapter sending to headphone (e.g. /org/bluez/hci1)
	dualMode   bool            // true when using two separate adapters
	log        *slog.Logger

	mu           sync.Mutex
	sinkDevice   dbus.ObjectPath // inbound device (phone) connected to us
	sourceDevice dbus.ObjectPath // outbound device (real headphone)
}

// NewAdapter creates a new Adapter. When SourceAdapter differs from SinkAdapter,
// dual-adapter mode is enabled with each radio handling one role.
func NewAdapter(cfg config.BluetoothConfig, logger *slog.Logger) (*Adapter, error) {
	conn, err := dbus.SystemBus()
	if err != nil {
		return nil, fmt.Errorf("connecting to system D-Bus: %w", err)
	}

	sinkPath := dbus.ObjectPath("/org/bluez/" + cfg.SinkAdapter)
	sourceAdapter := cfg.EffectiveSourceAdapter()
	sourcePath := dbus.ObjectPath("/org/bluez/" + sourceAdapter)
	dualMode := cfg.SinkAdapter != sourceAdapter

	log := logger.With("component", "bt.adapter")

	if dualMode {
		log.Info("dual-adapter mode",
			"sink_adapter", cfg.SinkAdapter,
			"source_adapter", sourceAdapter,
		)
	} else {
		log.Info("single-adapter mode", "adapter", cfg.SinkAdapter)
	}

	return &Adapter{
		cfg:        cfg,
		conn:       conn,
		sinkPath:   sinkPath,
		sourcePath: sourcePath,
		dualMode:   dualMode,
		log:        log,
	}, nil
}

// Setup configures the adapter(s) for A2DP operation.
// The sink adapter is made discoverable; the source adapter is powered on
// but kept non-discoverable (it only initiates outbound connections).
func (a *Adapter) Setup(ctx context.Context) error {
	// Configure sink adapter (receives audio from phones).
	a.log.Info("configuring sink adapter", "adapter", a.cfg.SinkAdapter)

	sinkObj := a.conn.Object(bluezBus, a.sinkPath)

	if err := a.setProperty(sinkObj, bluezAdapter, "Powered", true); err != nil {
		return fmt.Errorf("powering on sink adapter: %w", err)
	}
	if err := a.setProperty(sinkObj, bluezAdapter, "Discoverable", true); err != nil {
		return fmt.Errorf("setting sink discoverable: %w", err)
	}
	if err := a.setProperty(sinkObj, bluezAdapter, "Alias", a.cfg.SinkName); err != nil {
		return fmt.Errorf("setting sink alias: %w", err)
	}

	a.log.Info("sink adapter configured", "name", a.cfg.SinkName, "discoverable", true)

	// Configure source adapter if using dual-adapter mode.
	if a.dualMode {
		a.log.Info("configuring source adapter", "adapter", a.cfg.EffectiveSourceAdapter())

		sourceObj := a.conn.Object(bluezBus, a.sourcePath)

		if err := a.setProperty(sourceObj, bluezAdapter, "Powered", true); err != nil {
			return fmt.Errorf("powering on source adapter: %w", err)
		}
		// Source adapter should not be discoverable — it only makes outbound connections.
		if err := a.setProperty(sourceObj, bluezAdapter, "Discoverable", false); err != nil {
			return fmt.Errorf("setting source non-discoverable: %w", err)
		}

		a.log.Info("source adapter configured", "discoverable", false)
	}

	return nil
}

// ConnectHeadphone attempts to connect to the target headphone via the source adapter.
func (a *Adapter) ConnectHeadphone(ctx context.Context) error {
	if a.cfg.TargetHeadphone == "" {
		a.log.Warn("no target headphone configured, skipping outbound connection")
		return nil
	}

	devicePath := a.macToDevicePath(a.sourcePath, a.cfg.TargetHeadphone)
	device := a.conn.Object(bluezBus, devicePath)

	a.log.Info("connecting to headphone",
		"mac", a.cfg.TargetHeadphone,
		"via_adapter", a.cfg.EffectiveSourceAdapter(),
	)

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

func (a *Adapter) macToDevicePath(adapterPath dbus.ObjectPath, mac string) dbus.ObjectPath {
	escaped := strings.ReplaceAll(mac, ":", "_")
	return dbus.ObjectPath(fmt.Sprintf("%s/dev_%s", adapterPath, escaped))
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
