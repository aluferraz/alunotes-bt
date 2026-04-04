package bt

import (
	"fmt"
	"log/slog"
	"sync"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
)

const (
	bluezMedia         = "org.bluez.Media1"
	mediaEndpointIface = "org.bluez.MediaEndpoint1"

	// A2DP endpoint D-Bus paths.
	endpointSinkPath   = "/org/bluez/alunotes/endpoint_sink"
	endpointSourcePath = "/org/bluez/alunotes/endpoint_source"

	// SBC codec ID as defined by the Bluetooth A2DP spec.
	sbcCodecID byte = 0x00

	// SBC sampling frequency bitmask (byte 0, bits 7-4).
	sbcFreq16000 byte = 0x80
	sbcFreq32000 byte = 0x40
	sbcFreq44100 byte = 0x20
	sbcFreq48000 byte = 0x10

	// SBC channel mode bitmask (byte 0, bits 3-0).
	sbcModeMono        byte = 0x08
	sbcModeDualChannel byte = 0x04
	sbcModeStereo      byte = 0x02
	sbcModeJointStereo byte = 0x01

	// SBC block length bitmask (byte 1, bits 7-4).
	sbcBlocks4  byte = 0x80
	sbcBlocks8  byte = 0x40
	sbcBlocks12 byte = 0x20
	sbcBlocks16 byte = 0x10

	// SBC subbands bitmask (byte 1, bits 3-2).
	sbcSubbands4 byte = 0x04
	sbcSubbands8 byte = 0x08

	// SBC allocation method bitmask (byte 1, bits 1-0).
	sbcAllocSNR      byte = 0x02
	sbcAllocLoudness byte = 0x01
)

// MediaEndpoint implements the org.bluez.MediaEndpoint1 D-Bus interface.
// One instance is created per adapter role (sink or source).
type MediaEndpoint struct {
	role string // "sink" or "source"
	log  *slog.Logger

	mu        sync.Mutex
	transport dbus.ObjectPath
	codec     byte
	config    []byte
}

// TransportAcquiredCallback is called when BlueZ assigns a transport to an endpoint.
type TransportAcquiredCallback func(transport dbus.ObjectPath, role string, properties map[string]dbus.Variant)

// TransportClearedCallback is called when BlueZ removes a transport from an endpoint.
type TransportClearedCallback func(transport dbus.ObjectPath, role string)

// endpointRegistry holds global callbacks so endpoint D-Bus method calls can
// notify the adapter. Set once at registration time, read from D-Bus handler goroutines.
var (
	endpointMu              sync.Mutex
	onTransportSetConfig    TransportAcquiredCallback
	onTransportClearConfig  TransportClearedCallback
)

// SetConfiguration is called by BlueZ when it assigns a media transport to this
// endpoint after successful codec negotiation.
func (e *MediaEndpoint) SetConfiguration(transport dbus.ObjectPath, properties map[string]dbus.Variant) *dbus.Error {
	e.log.Info("transport configured",
		"role", e.role,
		"transport", transport,
	)

	e.mu.Lock()
	e.transport = transport
	if v, ok := properties["Codec"]; ok {
		if c, ok := v.Value().(byte); ok {
			e.codec = c
		}
	}
	if v, ok := properties["Configuration"]; ok {
		if cfg, ok := v.Value().([]byte); ok {
			e.config = cfg
			e.log.Info("SBC configuration received",
				"role", e.role,
				"config_bytes", fmt.Sprintf("%02x", cfg),
			)
		}
	}
	e.mu.Unlock()

	endpointMu.Lock()
	cb := onTransportSetConfig
	endpointMu.Unlock()
	if cb != nil {
		cb(transport, e.role, properties)
	}

	return nil
}

// SelectConfiguration is called by BlueZ during A2DP codec negotiation.
// capabilities contains the remote device's SBC capability bitmask (4 bytes).
// We pick the best configuration that both sides support and return it.
func (e *MediaEndpoint) SelectConfiguration(capabilities []byte) ([]byte, *dbus.Error) {
	e.log.Info("selecting SBC configuration",
		"role", e.role,
		"capabilities", fmt.Sprintf("%02x", capabilities),
	)

	if len(capabilities) < 4 {
		e.log.Error("capabilities too short", "len", len(capabilities))
		return nil, dbus.NewError("org.bluez.Error.InvalidArguments", []interface{}{"capabilities must be 4 bytes for SBC"})
	}

	config := make([]byte, 4)

	// Byte 0: Sampling Frequency | Channel Mode
	// Prefer 44100 Hz, fall back to 48000 Hz.
	freqBits := capabilities[0] & 0xF0
	switch {
	case freqBits&sbcFreq44100 != 0:
		config[0] = sbcFreq44100
	case freqBits&sbcFreq48000 != 0:
		config[0] = sbcFreq48000
	case freqBits&sbcFreq32000 != 0:
		config[0] = sbcFreq32000
	case freqBits&sbcFreq16000 != 0:
		config[0] = sbcFreq16000
	default:
		config[0] = sbcFreq44100 // default
	}

	// Prefer Joint Stereo > Stereo > Dual Channel > Mono.
	modeBits := capabilities[0] & 0x0F
	switch {
	case modeBits&sbcModeJointStereo != 0:
		config[0] |= sbcModeJointStereo
	case modeBits&sbcModeStereo != 0:
		config[0] |= sbcModeStereo
	case modeBits&sbcModeDualChannel != 0:
		config[0] |= sbcModeDualChannel
	case modeBits&sbcModeMono != 0:
		config[0] |= sbcModeMono
	default:
		config[0] |= sbcModeJointStereo
	}

	// Byte 1: Block Length | Subbands | Allocation Method
	// Prefer 16 blocks > 12 > 8 > 4.
	blockBits := capabilities[1] & 0xF0
	switch {
	case blockBits&sbcBlocks16 != 0:
		config[1] = sbcBlocks16
	case blockBits&sbcBlocks12 != 0:
		config[1] = sbcBlocks12
	case blockBits&sbcBlocks8 != 0:
		config[1] = sbcBlocks8
	case blockBits&sbcBlocks4 != 0:
		config[1] = sbcBlocks4
	default:
		config[1] = sbcBlocks16
	}

	// Prefer 8 subbands > 4.
	subBits := capabilities[1] & 0x0C
	switch {
	case subBits&sbcSubbands8 != 0:
		config[1] |= sbcSubbands8
	case subBits&sbcSubbands4 != 0:
		config[1] |= sbcSubbands4
	default:
		config[1] |= sbcSubbands8
	}

	// Prefer Loudness > SNR.
	allocBits := capabilities[1] & 0x03
	switch {
	case allocBits&sbcAllocLoudness != 0:
		config[1] |= sbcAllocLoudness
	case allocBits&sbcAllocSNR != 0:
		config[1] |= sbcAllocSNR
	default:
		config[1] |= sbcAllocLoudness
	}

	// Byte 2: Minimum Bitpool — use the remote's minimum, floor at 2.
	config[2] = capabilities[2]
	if config[2] < 2 {
		config[2] = 2
	}

	// Byte 3: Maximum Bitpool — cap at 53 (standard high quality) or remote's max.
	config[3] = capabilities[3]
	if config[3] > 53 {
		config[3] = 53
	}
	if config[3] < config[2] {
		config[3] = config[2]
	}

	e.log.Info("SBC configuration selected",
		"role", e.role,
		"config", fmt.Sprintf("%02x", config),
	)

	return config, nil
}

// ClearConfiguration is called by BlueZ when a transport is removed.
func (e *MediaEndpoint) ClearConfiguration(transport dbus.ObjectPath) *dbus.Error {
	e.log.Info("transport configuration cleared",
		"role", e.role,
		"transport", transport,
	)

	e.mu.Lock()
	e.transport = ""
	e.codec = 0
	e.config = nil
	e.mu.Unlock()

	endpointMu.Lock()
	cb := onTransportClearConfig
	endpointMu.Unlock()
	if cb != nil {
		cb(transport, e.role)
	}

	return nil
}

// Transport returns the current transport path assigned to this endpoint.
func (e *MediaEndpoint) Transport() dbus.ObjectPath {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.transport
}

// sbcCapabilities returns the SBC capability bytes advertising what we support.
// We advertise broad support so remote devices can negotiate freely.
func sbcCapabilities() []byte {
	return []byte{
		// Byte 0: All sampling frequencies | All channel modes
		sbcFreq16000 | sbcFreq32000 | sbcFreq44100 | sbcFreq48000 |
			sbcModeMono | sbcModeDualChannel | sbcModeStereo | sbcModeJointStereo,
		// Byte 1: All block lengths | Both subbands | Both allocation methods
		sbcBlocks4 | sbcBlocks8 | sbcBlocks12 | sbcBlocks16 |
			sbcSubbands4 | sbcSubbands8 |
			sbcAllocSNR | sbcAllocLoudness,
		// Byte 2: Minimum bitpool
		2,
		// Byte 3: Maximum bitpool
		53,
	}
}

// registerEndpoint exports a MediaEndpoint on D-Bus and registers it with
// the BlueZ Media1 interface on the given adapter.
func registerEndpoint(conn *dbus.Conn, adapterPath dbus.ObjectPath, endpointPath string, uuid string, role string, log *slog.Logger) (*MediaEndpoint, error) {
	ep := &MediaEndpoint{
		role: role,
		log:  log.With("component", "bt.endpoint", "role", role),
	}

	objPath := dbus.ObjectPath(endpointPath)

	// Export the endpoint object implementing MediaEndpoint1.
	if err := conn.Export(ep, objPath, mediaEndpointIface); err != nil {
		return nil, fmt.Errorf("exporting %s endpoint: %w", role, err)
	}

	// Export introspection data.
	node := &introspect.Node{
		Name: endpointPath,
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			{
				Name: mediaEndpointIface,
				Methods: []introspect.Method{
					{Name: "SetConfiguration", Args: []introspect.Arg{
						{Name: "transport", Type: "o", Direction: "in"},
						{Name: "properties", Type: "a{sv}", Direction: "in"},
					}},
					{Name: "SelectConfiguration", Args: []introspect.Arg{
						{Name: "capabilities", Type: "ay", Direction: "in"},
						{Name: "configuration", Type: "ay", Direction: "out"},
					}},
					{Name: "ClearConfiguration", Args: []introspect.Arg{
						{Name: "transport", Type: "o", Direction: "in"},
					}},
				},
			},
		},
	}
	if err := conn.Export(introspect.NewIntrospectable(node), objPath, "org.freedesktop.DBus.Introspectable"); err != nil {
		return nil, fmt.Errorf("exporting %s endpoint introspectable: %w", role, err)
	}

	// Register the endpoint with BlueZ's Media1 interface on the adapter.
	media := conn.Object(bluezBus, adapterPath)
	properties := map[string]dbus.Variant{
		"UUID":         dbus.MakeVariant(uuid),
		"Codec":        dbus.MakeVariant(sbcCodecID),
		"Capabilities": dbus.MakeVariant(sbcCapabilities()),
	}

	call := media.Call(bluezMedia+".RegisterEndpoint", 0, objPath, properties)
	if call.Err != nil {
		return nil, fmt.Errorf("registering %s endpoint with BlueZ: %w", role, call.Err)
	}

	ep.log.Info("media endpoint registered",
		"path", endpointPath,
		"adapter", adapterPath,
		"uuid", uuid,
	)

	return ep, nil
}

// RegisterEndpoints registers A2DP MediaEndpoint1 objects on both adapters.
// The sink endpoint (on sinkAdapterPath) receives audio from phones.
// The source endpoint (on sourceAdapterPath) sends audio to headphones.
// If sinkAdapterPath == sourceAdapterPath (single-adapter mode), only the sink is registered.
func RegisterEndpoints(conn *dbus.Conn, sinkAdapterPath, sourceAdapterPath dbus.ObjectPath, onSet TransportAcquiredCallback, onClear TransportClearedCallback, logger *slog.Logger) (sinkEP *MediaEndpoint, sourceEP *MediaEndpoint, err error) {
	// Store callbacks for use by endpoint D-Bus methods.
	endpointMu.Lock()
	onTransportSetConfig = onSet
	onTransportClearConfig = onClear
	endpointMu.Unlock()

	// Register sink endpoint (receives audio from phone).
	sinkEP, err = registerEndpoint(conn, sinkAdapterPath, endpointSinkPath, a2dpSinkUUID, "sink", logger)
	if err != nil {
		return nil, nil, fmt.Errorf("registering sink endpoint: %w", err)
	}

	// Register source endpoint (sends audio to headphone) — only in dual-adapter mode.
	if sourceAdapterPath != sinkAdapterPath {
		sourceEP, err = registerEndpoint(conn, sourceAdapterPath, endpointSourcePath, a2dpSourceUUID, "source", logger)
		if err != nil {
			return sinkEP, nil, fmt.Errorf("registering source endpoint: %w", err)
		}
	}

	return sinkEP, sourceEP, nil
}
