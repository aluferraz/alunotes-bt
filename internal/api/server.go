// Package api provides an HTTP API server for the bridge control plane.
// The Next.js web app calls these endpoints via oRPC server procedures.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/aluferraz/alunotes-bt/internal/bt"
	"github.com/aluferraz/alunotes-bt/internal/config"
	"github.com/aluferraz/alunotes-bt/internal/session"
)

// Server is the HTTP API server for the bridge.
type Server struct {
	cfg     config.Config
	adapter *bt.Adapter
	sessMgr *session.Manager
	log     *slog.Logger
	mux     *http.ServeMux
	srv     *http.Server
}

// NewServer creates a new API server.
func NewServer(cfg config.Config, adapter *bt.Adapter, sessMgr *session.Manager, logger *slog.Logger) *Server {
	s := &Server{
		cfg:     cfg,
		adapter: adapter,
		sessMgr: sessMgr,
		log:     logger.With("component", "api"),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/status", s.handleStatus)
	mux.HandleFunc("GET /api/v1/bluetooth/devices", s.handleDevices)
	mux.HandleFunc("POST /api/v1/bluetooth/connect", s.handleConnect)
	mux.HandleFunc("POST /api/v1/bluetooth/disconnect", s.handleDisconnect)
	mux.HandleFunc("POST /api/v1/bluetooth/remove", s.handleRemoveDevice)
	mux.HandleFunc("GET /api/v1/bluetooth/scan", s.handleScan)
	mux.HandleFunc("GET /api/v1/config", s.handleGetConfig)
	mux.HandleFunc("POST /api/v1/recording/stop", s.handleStopRecording)
	mux.HandleFunc("GET /api/v1/recording/auto-record", s.handleGetAutoRecord)
	mux.HandleFunc("POST /api/v1/recording/auto-record", s.handleSetAutoRecord)
	mux.HandleFunc("GET /health", s.handleHealth)

	s.mux = mux
	return s
}

// Start begins serving HTTP requests on the given address.
func (s *Server) Start(addr string) error {
	s.srv = &http.Server{
		Addr:              addr,
		Handler:           s.corsMiddleware(s.mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.log.Info("API server starting", "addr", addr)
	return s.srv.ListenAndServe()
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.srv == nil {
		return nil
	}
	return s.srv.Shutdown(ctx)
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// GET /api/v1/status
func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	status := s.adapter.Status()
	currentSession := s.sessMgr.Current()

	resp := map[string]interface{}{
		"bridgeRunning":      true,
		"discoverable":       s.adapter.Discoverable(),
		"sinkAdapter":        s.cfg.Bluetooth.SinkAdapter,
		"sourceAdapter":      s.cfg.Bluetooth.EffectiveSourceAdapter(),
		"dualMode":           s.cfg.Bluetooth.SinkAdapter != s.cfg.Bluetooth.EffectiveSourceAdapter(),
		"sinkName":           s.cfg.Bluetooth.SinkName,
		"connectedSource":    status.ConnectedSource,
		"connectedHeadphone": status.ConnectedHeadphone,
		"pipelineActive":     status.PipelineActive,
		"autoRecord":         s.sessMgr.AutoRecord(),
		"activeSession":      nil,
	}

	if currentSession != nil {
		resp["activeSession"] = map[string]interface{}{
			"id":        currentSession.ID,
			"startedAt": currentSession.StartedAt.Format(time.RFC3339),
			"duration":  time.Since(currentSession.StartedAt).Seconds(),
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// GET /api/v1/bluetooth/devices
func (s *Server) handleDevices(w http.ResponseWriter, _ *http.Request) {
	devices := s.adapter.ConnectedDevices()
	writeJSON(w, http.StatusOK, devices)
}

// POST /api/v1/bluetooth/connect
func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MACAddress string `json:"mac_address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.MACAddress == "" {
		writeError(w, http.StatusBadRequest, "mac_address is required")
		return
	}

	if err := s.adapter.ConnectDevice(r.Context(), req.MACAddress); err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("connection failed: %v", err),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("connected to %s", req.MACAddress),
	})
}

// POST /api/v1/bluetooth/disconnect
func (s *Server) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MACAddress string `json:"mac_address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.MACAddress == "" {
		writeError(w, http.StatusBadRequest, "mac_address is required")
		return
	}

	if err := s.adapter.DisconnectDevice(req.MACAddress); err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("disconnect failed: %v", err),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("disconnected from %s", req.MACAddress),
	})
}

// POST /api/v1/bluetooth/remove
func (s *Server) handleRemoveDevice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MACAddress string `json:"mac_address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.MACAddress == "" {
		writeError(w, http.StatusBadRequest, "mac_address is required")
		return
	}

	if err := s.adapter.RemoveDevice(req.MACAddress); err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("remove failed: %v", err),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("removed %s", req.MACAddress),
	})
}

// GET /api/v1/bluetooth/scan
func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	devices, err := s.adapter.ScanDevices(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("scan failed: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, devices)
}

// GET /api/v1/config
func (s *Server) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.cfg)
}

// GET /health
func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

// POST /api/v1/recording/stop
func (s *Server) handleStopRecording(w http.ResponseWriter, _ *http.Request) {
	s.sessMgr.Stop()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "recording stopped",
	})
}

// GET /api/v1/recording/auto-record
func (s *Server) handleGetAutoRecord(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled": s.sessMgr.AutoRecord(),
	})
}

// POST /api/v1/recording/auto-record
func (s *Server) handleSetAutoRecord(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	s.sessMgr.SetAutoRecord(req.Enabled)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"enabled": req.Enabled,
	})
}
