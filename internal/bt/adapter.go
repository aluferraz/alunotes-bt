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
	"time"

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

	mu              sync.Mutex
	sinkDevice      dbus.ObjectPath // inbound device (phone) connected to us
	sourceDevice    dbus.ObjectPath // outbound device (real headphone)
	sinkTransport   dbus.ObjectPath // inbound media transport path
	sinkFD          int             // inbound transport file descriptor
	sourceTransport dbus.ObjectPath // outbound media transport path
	sourceFD        int             // outbound transport file descriptor
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

	a.log.Info("watching for Bluetooth events")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case sig := <-sigCh:
			a.logSignal(sig)
			a.handleSignal(sig, onAcquire, onRelease)
		}
	}
}

// TransportInfo holds the details needed to acquire and use an A2DP transport.
type TransportInfo struct {
	Path dbus.ObjectPath
	FD   int
	Role string // "sink" (inbound from phone) or "source" (outbound to headphone)
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

	// Log the codec info from the transport's D-Bus properties.
	if codecVar, err := transport.GetProperty(bluezMediaTrans + ".Codec"); err == nil {
		a.log.Info("transport codec", "path", path, "codec", codecVar.Value())
	}
	if cfgVar, err := transport.GetProperty(bluezMediaTrans + ".Configuration"); err == nil {
		if cfg, ok := cfgVar.Value().([]byte); ok {
			a.log.Info("transport configuration", "path", path, "config", fmt.Sprintf("%02x", cfg))
		}
	}
	if uuidVar, err := transport.GetProperty(bluezMediaTrans + ".UUID"); err == nil {
		a.log.Info("transport uuid", "path", path, "uuid", uuidVar.Value())
	}

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

// SinkPath returns the D-Bus object path for the sink adapter.
func (a *Adapter) SinkPath() dbus.ObjectPath {
	return a.sinkPath
}

// SourcePath returns the D-Bus object path for the source adapter.
func (a *Adapter) SourcePath() dbus.ObjectPath {
	return a.sourcePath
}

// DualMode returns true if separate adapters are used for sink and source roles.
func (a *Adapter) DualMode() bool {
	return a.dualMode
}

// SinkTransportFD returns the file descriptor for the inbound (sink) transport.
// Returns 0 if no sink transport has been acquired.
func (a *Adapter) SinkTransportFD() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sinkFD
}

// SourceTransportFD returns the file descriptor for the outbound (source) transport.
// Returns 0 if no source transport has been acquired.
func (a *Adapter) SourceTransportFD() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sourceFD
}

// SetTransport stores a transport path and FD for the given role.
func (a *Adapter) SetTransport(role string, path dbus.ObjectPath, fd int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	switch role {
	case "sink":
		a.sinkTransport = path
		a.sinkFD = fd
		a.log.Info("sink transport stored", "path", path, "fd", fd)
	case "source":
		a.sourceTransport = path
		a.sourceFD = fd
		a.log.Info("source transport stored", "path", path, "fd", fd)
	}
}

// ClearTransport clears the transport for the given role.
func (a *Adapter) ClearTransport(role string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	switch role {
	case "sink":
		a.sinkTransport = ""
		a.sinkFD = 0
		a.log.Info("sink transport cleared")
	case "source":
		a.sourceTransport = ""
		a.sourceFD = 0
		a.log.Info("source transport cleared")
	}
}

// transportRole determines the role of a transport based on its D-Bus path.
// Returns "sink" if the transport is under the sink adapter path, "source" if
// under the source adapter path, or "unknown".
func (a *Adapter) transportRole(transportPath dbus.ObjectPath) string {
	pathStr := string(transportPath)
	sinkPrefix := string(a.sinkPath) + "/"
	sourcePrefix := string(a.sourcePath) + "/"

	if strings.HasPrefix(pathStr, sinkPrefix) {
		return "sink"
	}
	if a.dualMode && strings.HasPrefix(pathStr, sourcePrefix) {
		return "source"
	}
	// In single-adapter mode, transports under the same adapter are sinks.
	return "sink"
}

// Discoverable returns whether the sink adapter is currently discoverable.
func (a *Adapter) Discoverable() bool {
	sinkObj := a.conn.Object(bluezBus, a.sinkPath)
	v, err := sinkObj.GetProperty(bluezAdapter + ".Discoverable")
	if err != nil {
		return false
	}
	d, _ := v.Value().(bool)
	return d
}

// Teardown powers off Bluetooth adapters on shutdown so they don't remain
// active when the bridge is not running. This handles graceful exits
// (SIGINT/SIGTERM). For ungraceful exits (SIGKILL/crash), the systemd
// ExecStopPost command provides a safety net.
func (a *Adapter) Teardown() error {
	var firstErr error

	// Power off sink adapter.
	sinkObj := a.conn.Object(bluezBus, a.sinkPath)
	if err := a.setProperty(sinkObj, bluezAdapter, "Discoverable", false); err != nil {
		a.log.Warn("failed to set sink non-discoverable", "error", err)
		if firstErr == nil {
			firstErr = err
		}
	}
	if err := a.setProperty(sinkObj, bluezAdapter, "Powered", false); err != nil {
		a.log.Warn("failed to power off sink adapter", "error", err)
		if firstErr == nil {
			firstErr = err
		}
	} else {
		a.log.Info("sink adapter powered off")
	}

	// Power off source adapter (if dual-mode).
	if a.dualMode {
		sourceObj := a.conn.Object(bluezBus, a.sourcePath)
		if err := a.setProperty(sourceObj, bluezAdapter, "Powered", false); err != nil {
			a.log.Warn("failed to power off source adapter", "error", err)
			if firstErr == nil {
				firstErr = err
			}
		} else {
			a.log.Info("source adapter powered off")
		}
	}

	return firstErr
}

// Conn returns the underlying D-Bus connection for use by other components
// (e.g. the pairing agent).
func (a *Adapter) Conn() *dbus.Conn {
	return a.conn
}

// Close disconnects from D-Bus.
func (a *Adapter) Close() error {
	return a.conn.Close()
}

// AdapterStatus holds the current state of the Bluetooth adapter for the API.
type AdapterStatus struct {
	ConnectedSource   *DeviceInfo `json:"connectedSource"`
	ConnectedHeadphone *DeviceInfo `json:"connectedHeadphone"`
	PipelineActive    bool        `json:"pipelineActive"`
}

// DeviceInfo holds information about a connected Bluetooth device.
type DeviceInfo struct {
	Name      string `json:"name"`
	MAC       string `json:"mac"`
	Connected bool   `json:"connected"`
}

// Status returns the current status of the adapter and connected devices.
func (a *Adapter) Status() AdapterStatus {
	a.mu.Lock()
	defer a.mu.Unlock()

	status := AdapterStatus{}

	if a.sinkDevice != "" {
		info := a.getDeviceInfo(a.sinkDevice)
		status.ConnectedSource = info
	}
	if a.sourceDevice != "" {
		info := a.getDeviceInfo(a.sourceDevice)
		status.ConnectedHeadphone = info
		status.PipelineActive = true
	}

	return status
}

// ConnectedDevices returns a list of connected Bluetooth devices.
func (a *Adapter) ConnectedDevices() []DeviceInfo {
	a.mu.Lock()
	defer a.mu.Unlock()

	var devices []DeviceInfo
	if a.sinkDevice != "" {
		if info := a.getDeviceInfo(a.sinkDevice); info != nil {
			devices = append(devices, *info)
		}
	}
	if a.sourceDevice != "" {
		if info := a.getDeviceInfo(a.sourceDevice); info != nil {
			devices = append(devices, *info)
		}
	}
	return devices
}

// ConnectDevice connects to a Bluetooth device by MAC address via the source adapter.
func (a *Adapter) ConnectDevice(ctx context.Context, mac string) error {
	devicePath := a.macToDevicePath(a.sourcePath, mac)
	device := a.conn.Object(bluezBus, devicePath)

	a.log.Info("connecting to device", "mac", mac)
	call := device.CallWithContext(ctx, bluezDevice+".Connect", 0)
	if call.Err != nil {
		return fmt.Errorf("connecting to %s: %w", mac, call.Err)
	}

	a.mu.Lock()
	a.sourceDevice = devicePath
	a.mu.Unlock()

	a.log.Info("device connected", "mac", mac)
	return nil
}

// DisconnectDevice disconnects a Bluetooth device by MAC address.
func (a *Adapter) DisconnectDevice(mac string) error {
	devicePath := a.macToDevicePath(a.sourcePath, mac)
	device := a.conn.Object(bluezBus, devicePath)

	a.log.Info("disconnecting device", "mac", mac)
	call := device.Call(bluezDevice+".Disconnect", 0)
	if call.Err != nil {
		return fmt.Errorf("disconnecting %s: %w", mac, call.Err)
	}

	a.mu.Lock()
	if a.sourceDevice == devicePath {
		a.sourceDevice = ""
	}
	if a.sinkDevice == devicePath {
		a.sinkDevice = ""
	}
	a.mu.Unlock()

	a.log.Info("device disconnected", "mac", mac)
	return nil
}

// RemoveDevice unpairs and removes a Bluetooth device by MAC address.
// It calls BlueZ Adapter1.RemoveDevice which disconnects, unpairs, and
// removes the device object entirely.
func (a *Adapter) RemoveDevice(mac string) error {
	// Try both adapters — the device could be paired on either.
	removed := false
	for _, adapterPath := range []dbus.ObjectPath{a.sinkPath, a.sourcePath} {
		devicePath := a.macToDevicePath(adapterPath, mac)
		adapter := a.conn.Object(bluezBus, adapterPath)

		call := adapter.Call(bluezAdapter+".RemoveDevice", 0, devicePath)
		if call.Err == nil {
			a.log.Info("device removed", "mac", mac, "adapter", adapterPath)
			removed = true
		}
	}

	if !removed {
		return fmt.Errorf("device %s not found on any adapter", mac)
	}

	a.mu.Lock()
	for _, adapterPath := range []dbus.ObjectPath{a.sinkPath, a.sourcePath} {
		devicePath := a.macToDevicePath(adapterPath, mac)
		if a.sourceDevice == devicePath {
			a.sourceDevice = ""
		}
		if a.sinkDevice == devicePath {
			a.sinkDevice = ""
		}
	}
	a.mu.Unlock()

	return nil
}

// DiscoveredDevice holds information about a Bluetooth device found during scanning.
type DiscoveredDevice struct {
	Name      string `json:"name"`
	MAC       string `json:"mac"`
	RSSI      int16  `json:"rssi"`
	Connected bool   `json:"connected"`
	Paired    bool   `json:"paired"`
}

// ScanDevices triggers a BlueZ discovery scan on the source adapter and returns
// discovered devices. Uses the source adapter because ConnectDevice also uses it,
// and BlueZ device objects are scoped to the adapter that discovered them.
// Falls back to the sink adapter if not in dual-adapter mode.
func (a *Adapter) ScanDevices(ctx context.Context) ([]DiscoveredDevice, error) {
	adapterPath := a.sourcePath
	adapter := a.conn.Object(bluezBus, adapterPath)

	// Set discovery filter to find both Classic (BR/EDR) and BLE devices.
	// Without this, some adapters default to BLE-only and miss A2DP devices
	// like headphones that advertise via Classic Bluetooth.
	filter := map[string]dbus.Variant{
		"Transport": dbus.MakeVariant("auto"),
	}
	filterCall := adapter.CallWithContext(ctx, bluezAdapter+".SetDiscoveryFilter", 0, filter)
	if filterCall.Err != nil {
		a.log.Warn("failed to set discovery filter, proceeding with defaults", "error", filterCall.Err)
	}

	// Start discovery
	call := adapter.CallWithContext(ctx, bluezAdapter+".StartDiscovery", 0)
	if call.Err != nil {
		if !strings.Contains(call.Err.Error(), "InProgress") {
			return nil, fmt.Errorf("starting discovery: %w", call.Err)
		}
	}

	// Let discovery run for a few seconds
	scanTimer := time.NewTimer(8 * time.Second)
	defer scanTimer.Stop()
	select {
	case <-ctx.Done():
	case <-scanTimer.C:
	}

	// Stop discovery (best-effort)
	stopCall := adapter.Call(bluezAdapter+".StopDiscovery", 0)
	if stopCall.Err != nil {
		a.log.Debug("stop discovery", "error", stopCall.Err)
	}

	return a.listKnownDevices(adapterPath)
}

// listKnownDevices enumerates all BlueZ device objects under an adapter.
func (a *Adapter) listKnownDevices(adapterPath dbus.ObjectPath) ([]DiscoveredDevice, error) {
	objManager := a.conn.Object(bluezBus, "/")
	var managedObjects map[dbus.ObjectPath]map[string]map[string]dbus.Variant
	if err := objManager.Call(dbusObjectManager+".GetManagedObjects", 0).Store(&managedObjects); err != nil {
		return nil, fmt.Errorf("getting managed objects: %w", err)
	}

	adapterPrefix := string(adapterPath) + "/dev_"
	var devices []DiscoveredDevice

	for path, ifaces := range managedObjects {
		pathStr := string(path)
		if !strings.HasPrefix(pathStr, adapterPrefix) {
			continue
		}
		devProps, ok := ifaces[bluezDevice]
		if !ok {
			continue
		}

		dev := DiscoveredDevice{}

		// Read properties from the snapshot first.
		if v, ok := devProps["Address"]; ok {
			if mac, ok := v.Value().(string); ok {
				dev.MAC = mac
			}
		}
		if v, ok := devProps["RSSI"]; ok {
			if rssi, ok := v.Value().(int16); ok {
				dev.RSSI = rssi
			}
		}
		if v, ok := devProps["Connected"]; ok {
			if c, ok := v.Value().(bool); ok {
				dev.Connected = c
			}
		}
		if v, ok := devProps["Paired"]; ok {
			if p, ok := v.Value().(bool); ok {
				dev.Paired = p
			}
		}

		// Name/Alias may not be in the snapshot yet — read live from D-Bus.
		devObj := a.conn.Object(bluezBus, path)
		if nameVar, err := devObj.GetProperty(bluezDevice + ".Name"); err == nil {
			if name, ok := nameVar.Value().(string); ok {
				dev.Name = name
			}
		}
		if dev.Name == "" {
			if aliasVar, err := devObj.GetProperty(bluezDevice + ".Alias"); err == nil {
				if alias, ok := aliasVar.Value().(string); ok && !looksLikeMAC(alias) {
					dev.Name = alias
				}
			}
		}

		if dev.MAC != "" {
			devices = append(devices, dev)
		}
	}

	return devices, nil
}

// getDeviceInfo retrieves name and MAC for a device path from BlueZ.
func (a *Adapter) getDeviceInfo(path dbus.ObjectPath) *DeviceInfo {
	device := a.conn.Object(bluezBus, path)

	nameVariant, err := device.GetProperty(bluezDevice + ".Name")
	name := "Unknown"
	if err == nil {
		if n, ok := nameVariant.Value().(string); ok {
			name = n
		}
	}

	// Extract MAC from path: /org/bluez/hciX/dev_AA_BB_CC_DD_EE_FF
	pathStr := string(path)
	mac := ""
	if idx := strings.LastIndex(pathStr, "dev_"); idx >= 0 {
		mac = strings.ReplaceAll(pathStr[idx+4:], "_", ":")
	}

	connVariant, err := device.GetProperty(bluezDevice + ".Connected")
	connected := false
	if err == nil {
		if c, ok := connVariant.Value().(bool); ok {
			connected = c
		}
	}

	return &DeviceInfo{
		Name:      name,
		MAC:       mac,
		Connected: connected,
	}
}

// trackDeviceFromTransport extracts the device path from a transport path
// (e.g. /org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/fd0) and sets sinkDevice
// if the transport belongs to the sink adapter.
func (a *Adapter) trackDeviceFromTransport(transportPath dbus.ObjectPath) {
	pathStr := string(transportPath)
	sinkPrefix := string(a.sinkPath) + "/dev_"

	if !strings.HasPrefix(pathStr, sinkPrefix) {
		return
	}

	// Extract device path: everything up to the last "/" after dev_
	devIdx := strings.Index(pathStr, "/dev_")
	if devIdx < 0 {
		return
	}
	// Find end of device segment (next "/" after /dev_XX_XX...)
	rest := pathStr[devIdx+1:] // "dev_AA_BB_.../fdN"
	if slashIdx := strings.Index(rest, "/"); slashIdx > 0 {
		rest = rest[:slashIdx]
	}
	devicePath := dbus.ObjectPath(pathStr[:devIdx+1] + rest)

	a.mu.Lock()
	a.sinkDevice = devicePath
	a.mu.Unlock()
	a.log.Info("tracked inbound device", "device", devicePath)
}

// clearSinkDevice clears the tracked inbound sink device.
func (a *Adapter) clearSinkDevice() {
	a.mu.Lock()
	a.sinkDevice = ""
	a.mu.Unlock()
}

// autoTrustDevice sets the Trusted property on a device so it can reconnect automatically.
func (a *Adapter) autoTrustDevice(path dbus.ObjectPath) {
	device := a.conn.Object(bluezBus, path)
	if err := a.setProperty(device, bluezDevice, "Trusted", true); err != nil {
		a.log.Warn("failed to auto-trust device", "path", path, "error", err)
	} else {
		a.log.Info("device auto-trusted", "path", path)
	}
}

// looksLikeMAC returns true if s looks like a MAC address (AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF).
func looksLikeMAC(s string) bool {
	if len(s) != 17 {
		return false
	}
	for i, c := range s {
		if (i+1)%3 == 0 {
			if c != ':' && c != '-' {
				return false
			}
		} else {
			if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f')) {
				return false
			}
		}
	}
	return true
}

func (a *Adapter) setProperty(obj dbus.BusObject, iface, prop string, value interface{}) error {
	call := obj.Call(dbusProperties+".Set", 0, iface, prop, dbus.MakeVariant(value))
	return call.Err
}

func (a *Adapter) macToDevicePath(adapterPath dbus.ObjectPath, mac string) dbus.ObjectPath {
	escaped := strings.ReplaceAll(mac, ":", "_")
	return dbus.ObjectPath(fmt.Sprintf("%s/dev_%s", adapterPath, escaped))
}

// logSignal logs all D-Bus signals from BlueZ for debugging.
func (a *Adapter) logSignal(sig *dbus.Signal) {
	if sig == nil {
		return
	}

	switch sig.Name {
	case "org.freedesktop.DBus.Properties.PropertiesChanged":
		if len(sig.Body) < 2 {
			return
		}
		iface, _ := sig.Body[0].(string)
		changed, _ := sig.Body[1].(map[string]dbus.Variant)
		props := make([]string, 0, len(changed))
		for k, v := range changed {
			props = append(props, fmt.Sprintf("%s=%v", k, v.Value()))
		}
		a.log.Debug("dbus properties changed", "path", sig.Path, "interface", iface, "properties", props)

		// Log device-level events (connect, pair, trust) at Info level
		if iface == bluezDevice {
			for k, v := range changed {
				switch k {
				case "Connected":
					a.log.Info("device connection changed", "path", sig.Path, "connected", v.Value())
				case "Paired":
					paired, _ := v.Value().(bool)
					a.log.Info("device pairing changed", "path", sig.Path, "paired", paired)
					// Auto-trust newly paired devices so they can reconnect
					if paired {
						a.autoTrustDevice(sig.Path)
					}
				case "Trusted":
					a.log.Info("device trust changed", "path", sig.Path, "trusted", v.Value())
				case "ServicesResolved":
					a.log.Info("device services resolved", "path", sig.Path, "resolved", v.Value())
				}
			}
		}

	case "org.freedesktop.DBus.ObjectManager.InterfacesAdded":
		if len(sig.Body) >= 2 {
			path, _ := sig.Body[0].(dbus.ObjectPath)
			ifaces, _ := sig.Body[1].(map[string]map[string]dbus.Variant)
			ifaceNames := make([]string, 0, len(ifaces))
			for k := range ifaces {
				ifaceNames = append(ifaceNames, k)
			}
			a.log.Info("dbus interfaces added", "path", path, "interfaces", ifaceNames)
		}

	case "org.freedesktop.DBus.ObjectManager.InterfacesRemoved":
		if len(sig.Body) >= 2 {
			path, _ := sig.Body[0].(dbus.ObjectPath)
			ifaces, _ := sig.Body[1].([]string)
			a.log.Info("dbus interfaces removed", "path", path, "interfaces", ifaces)
		}

	default:
		a.log.Debug("dbus signal", "name", sig.Name, "path", sig.Path)
	}
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
			role := a.transportRole(path)
			a.log.Info("media transport added", "path", path, "role", role)
			a.trackDeviceFromTransport(path)
			onAcquire(TransportInfo{Path: path, Role: role})
		}

	case "org.freedesktop.DBus.ObjectManager.InterfacesRemoved":
		if len(sig.Body) < 2 {
			return
		}
		path, ok := sig.Body[0].(dbus.ObjectPath)
		if !ok {
			return
		}
		ifaces, ok := sig.Body[1].([]string)
		if !ok {
			return
		}
		for _, iface := range ifaces {
			if iface == bluezMediaTrans {
				role := a.transportRole(path)
				a.log.Info("media transport removed", "path", path, "role", role)
				a.ClearTransport(role)
				if role == "sink" {
					a.clearSinkDevice()
				}
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
			role := a.transportRole(sig.Path)
			a.log.Info("transport state changed", "state", state, "path", sig.Path, "role", role)
			if state == "pending" || state == "active" {
				a.trackDeviceFromTransport(sig.Path)
				onAcquire(TransportInfo{Path: sig.Path, Role: role})
			} else if state == "idle" {
				a.ClearTransport(role)
				// NOTE: do NOT clear sinkDevice here. The transport going
				// idle (e.g. music paused) does not mean the phone
				// disconnected. The device is only cleared when the
				// transport interface is fully removed (InterfacesRemoved).
				onRelease()
			}
		}
	}
}
