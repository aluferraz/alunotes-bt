package bt

import (
	"fmt"
	"log/slog"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
)

const (
	// A2DP UUIDs used by both profile.go and endpoint.go.
	a2dpSinkUUID   = "0000110b-0000-1000-8000-00805f9b34fb"
	a2dpSourceUUID = "0000110a-0000-1000-8000-00805f9b34fb"
	profileManager = "org.bluez.ProfileManager1"
	profilePath    = "/org/bluez/alunotes"
)

// A2DPProfile implements the BlueZ Profile1 interface.
// Note: A2DP codec negotiation is handled by MediaEndpoint1 (see endpoint.go).
// This Profile1 registration is kept only as a connection lifecycle handler —
// it does NOT register with the A2DP sink UUID, which would conflict with
// the MediaEndpoint1 registration.
type A2DPProfile struct {
	log *slog.Logger
}

// RegisterProfile registers our application profile with BlueZ.
// This registers as a generic audio handler — actual A2DP media negotiation
// is handled by the MediaEndpoint1 objects registered in endpoint.go.
func RegisterProfile(conn *dbus.Conn, logger *slog.Logger) error {
	profile := &A2DPProfile{log: logger.With("component", "bt.profile")}

	// Export our profile object on D-Bus.
	if err := conn.Export(profile, profilePath, "org.bluez.Profile1"); err != nil {
		return fmt.Errorf("exporting profile: %w", err)
	}

	// Export introspection data.
	node := &introspect.Node{
		Name: profilePath,
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			{
				Name: "org.bluez.Profile1",
				Methods: []introspect.Method{
					{Name: "Release"},
					{Name: "NewConnection", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
						{Name: "fd", Type: "h", Direction: "in"},
						{Name: "fd_properties", Type: "a{sv}", Direction: "in"},
					}},
					{Name: "RequestDisconnection", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
					}},
				},
			},
		},
	}
	if err := conn.Export(introspect.NewIntrospectable(node), profilePath, "org.freedesktop.DBus.Introspectable"); err != nil {
		return fmt.Errorf("exporting introspectable: %w", err)
	}

	profile.log.Info("profile object exported (A2DP handled by MediaEndpoint1)")
	return nil
}

// Release is called by BlueZ when the profile is unregistered.
func (p *A2DPProfile) Release() *dbus.Error {
	p.log.Info("profile released")
	return nil
}

// NewConnection is called by BlueZ when a device connects to our profile.
func (p *A2DPProfile) NewConnection(device dbus.ObjectPath, fd dbus.UnixFD, props map[string]dbus.Variant) *dbus.Error {
	p.log.Info("new profile connection", "device", device, "fd", fd)
	return nil
}

// RequestDisconnection is called by BlueZ when a device disconnects.
func (p *A2DPProfile) RequestDisconnection(device dbus.ObjectPath) *dbus.Error {
	p.log.Info("profile disconnection requested", "device", device)
	return nil
}
