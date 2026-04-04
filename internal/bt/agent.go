package bt

import (
	"fmt"
	"log/slog"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
)

const (
	agentInterface = "org.bluez.Agent1"
	agentManager   = "org.bluez.AgentManager1"
	agentPath      = "/org/bluez/alunotes/agent"
)

// Agent implements the BlueZ Agent1 interface to handle pairing requests.
// It uses "NoInputNoOutput" capability to enable auto-accept pairing (Just Works).
type Agent struct {
	log *slog.Logger
}

// RegisterAgent registers a pairing agent with BlueZ that auto-accepts
// pairing requests. This is required so phones can pair without PIN entry.
func RegisterAgent(conn *dbus.Conn, logger *slog.Logger) error {
	agent := &Agent{log: logger.With("component", "bt.agent")}

	// Export the agent object on D-Bus.
	if err := conn.Export(agent, agentPath, agentInterface); err != nil {
		return fmt.Errorf("exporting agent: %w", err)
	}

	// Export introspection data.
	node := &introspect.Node{
		Name: agentPath,
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			{
				Name: agentInterface,
				Methods: []introspect.Method{
					{Name: "Release"},
					{Name: "RequestPinCode", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
						{Name: "pincode", Type: "s", Direction: "out"},
					}},
					{Name: "DisplayPinCode", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
						{Name: "pincode", Type: "s", Direction: "in"},
					}},
					{Name: "RequestPasskey", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
						{Name: "passkey", Type: "u", Direction: "out"},
					}},
					{Name: "DisplayPasskey", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
						{Name: "passkey", Type: "u", Direction: "in"},
						{Name: "entered", Type: "q", Direction: "in"},
					}},
					{Name: "RequestConfirmation", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
						{Name: "passkey", Type: "u", Direction: "in"},
					}},
					{Name: "RequestAuthorization", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
					}},
					{Name: "AuthorizeService", Args: []introspect.Arg{
						{Name: "device", Type: "o", Direction: "in"},
						{Name: "uuid", Type: "s", Direction: "in"},
					}},
					{Name: "Cancel"},
				},
			},
		},
	}
	if err := conn.Export(introspect.NewIntrospectable(node), agentPath, "org.freedesktop.DBus.Introspectable"); err != nil {
		return fmt.Errorf("exporting agent introspectable: %w", err)
	}

	// Register with BlueZ AgentManager.
	manager := conn.Object(bluezBus, "/org/bluez")

	call := manager.Call(agentManager+".RegisterAgent", 0, dbus.ObjectPath(agentPath), "DisplayYesNo")
	if call.Err != nil {
		return fmt.Errorf("registering agent: %w", call.Err)
	}

	// Request to be the default agent.
	call = manager.Call(agentManager+".RequestDefaultAgent", 0, dbus.ObjectPath(agentPath))
	if call.Err != nil {
		return fmt.Errorf("requesting default agent: %w", call.Err)
	}

	agent.log.Info("pairing agent registered as default")
	return nil
}

// Release is called when the agent is unregistered.
func (a *Agent) Release() *dbus.Error {
	a.log.Info("agent released")
	return nil
}

// RequestPinCode returns a PIN code for legacy pairing.
func (a *Agent) RequestPinCode(device dbus.ObjectPath) (string, *dbus.Error) {
	a.log.Info("PIN code requested, auto-accepting", "device", device)
	return "0000", nil
}

// DisplayPinCode is called to display a PIN code to the user.
func (a *Agent) DisplayPinCode(device dbus.ObjectPath, pincode string) *dbus.Error {
	a.log.Info("display PIN code", "device", device, "pin", pincode)
	return nil
}

// RequestPasskey returns a passkey for pairing.
func (a *Agent) RequestPasskey(device dbus.ObjectPath) (uint32, *dbus.Error) {
	a.log.Info("passkey requested, auto-accepting", "device", device)
	return 0, nil
}

// DisplayPasskey is called to display a passkey to the user.
func (a *Agent) DisplayPasskey(device dbus.ObjectPath, passkey uint32, entered uint16) *dbus.Error {
	a.log.Info("display passkey", "device", device, "passkey", passkey)
	return nil
}

// RequestConfirmation auto-accepts pairing confirmation requests.
func (a *Agent) RequestConfirmation(device dbus.ObjectPath, passkey uint32) *dbus.Error {
	a.log.Info("pairing confirmation auto-accepted", "device", device, "passkey", passkey)
	return nil
}

// RequestAuthorization auto-accepts authorization requests.
func (a *Agent) RequestAuthorization(device dbus.ObjectPath) *dbus.Error {
	a.log.Info("authorization auto-accepted", "device", device)
	return nil
}

// AuthorizeService auto-accepts service authorization requests.
func (a *Agent) AuthorizeService(device dbus.ObjectPath, uuid string) *dbus.Error {
	a.log.Info("service authorized", "device", device, "uuid", uuid)
	return nil
}

// Cancel is called when a pairing request is cancelled.
func (a *Agent) Cancel() *dbus.Error {
	a.log.Info("pairing cancelled")
	return nil
}
