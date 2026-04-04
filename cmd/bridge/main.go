// Command bridge is the main entrypoint for the AluNotes Bluetooth audio bridge.
//
// It sets up the Bluetooth adapter as an A2DP sink, optionally connects to a
// real headphone as an A2DP source, and records audio via PipeWire.
// PipeWire handles all A2DP codec negotiation/decode and audio routing.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"net/http"

	"github.com/aluferraz/alunotes-bt/internal/api"
	"github.com/aluferraz/alunotes-bt/internal/audio"
	"github.com/aluferraz/alunotes-bt/internal/bt"
	"github.com/aluferraz/alunotes-bt/internal/config"
	"github.com/aluferraz/alunotes-bt/internal/logging"
	"github.com/aluferraz/alunotes-bt/internal/session"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to configuration file")
	apiAddr := flag.String("api-addr", ":8090", "HTTP API listen address")
	flag.Parse()

	// Structured logger with pretty console output and rotated JSON file.
	logLevel := slog.LevelInfo
	if os.Getenv("DEBUG") != "" {
		logLevel = slog.LevelDebug
	}
	log := logging.Setup(logging.Options{
		Level:   logLevel,
		LogDir:  "logs",
		LogFile: "bridge.log",
	})
	slog.SetDefault(log)

	// Load configuration.
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Error("failed to load config", "error", err)
		os.Exit(1)
	}
	log.Info("configuration loaded",
		"sink_adapter", cfg.Bluetooth.SinkAdapter,
		"source_adapter", cfg.Bluetooth.EffectiveSourceAdapter(),
		"sink_name", cfg.Bluetooth.SinkName,
		"target_headphone", cfg.Bluetooth.TargetHeadphone,
		"idle_timeout", cfg.Session.IdleTimeout,
		"storage_dir", cfg.Storage.BaseDir,
	)

	// Context cancelled on SIGINT/SIGTERM.
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Initialize Bluetooth adapter.
	adapter, err := bt.NewAdapter(cfg.Bluetooth, log)
	if err != nil {
		log.Error("failed to create Bluetooth adapter", "error", err)
		os.Exit(1)
	}
	defer adapter.Close()

	if err := adapter.Setup(ctx); err != nil {
		log.Error("failed to setup adapter", "error", err)
		os.Exit(1)
	}

	// Register pairing agent so phones can pair without PIN prompts.
	if err := bt.RegisterAgent(adapter.Conn(), log); err != nil {
		log.Error("failed to register pairing agent", "error", err)
		os.Exit(1)
	}

	// Connect to target headphone if configured.
	if cfg.Bluetooth.AutoConnect && cfg.Bluetooth.TargetHeadphone != "" {
		if err := adapter.ConnectHeadphone(ctx); err != nil {
			log.Warn("headphone connection failed (will retry on transport)", "error", err)
		}
	}

	// Session manager.
	sessMgr := session.NewManager(cfg.Session, cfg.Storage, log)

	// Done channel for goroutine lifecycle (idle watcher, etc.)
	done := make(chan struct{})

	// Session end callback.
	sessMgr.OnSessionEnd(func(s *session.Session) {
		log.Info("recording session completed", "id", s.ID, "dir", s.Dir)
	})

	// Start idle watcher.
	go sessMgr.RunIdleWatcher(done)

	// PipeWire-based audio pipeline.
	// Instead of reading raw encoded data from BlueZ transport FDs,
	// we let PipeWire handle A2DP codec negotiation/decode and read
	// clean PCM from PipeWire. PipeWire also handles audio routing
	// from the phone to the headphone.
	var pipelineDone chan struct{}
	var pipelineCancel context.CancelFunc
	var pipelineMu sync.Mutex

	pwCapture := audio.NewPipeWireCapture(sessMgr, log)

	stopPipeline := func() {
		pipelineMu.Lock()
		defer pipelineMu.Unlock()
		if pipelineCancel != nil {
			pipelineCancel()
			pipelineCancel = nil
		}
		if pipelineDone != nil {
			close(pipelineDone)
			pipelineDone = nil
			log.Info("pipeline stopped")
		}
	}

	// Extract MAC from a BlueZ device path like /org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF
	extractMAC := func(path string) string {
		idx := strings.LastIndex(path, "dev_")
		if idx < 0 {
			return ""
		}
		mac := path[idx+4:]
		// Remove any trailing path components (e.g. /fd0)
		if slashIdx := strings.Index(mac, "/"); slashIdx > 0 {
			mac = mac[:slashIdx]
		}
		return strings.ReplaceAll(mac, "_", ":")
	}

	// Track the current pipeline's source MAC to avoid restarting for the same device.
	var currentSourceMAC string
	// Track headphone MAC detected from source transports.
	var headphoneMAC string

	// When a sink device connects (phone → Pi), start PipeWire capture for recording
	// and link audio to the headphone if connected.
	onTransportAcquire := func(info bt.TransportInfo) {
		if info.Role == "source" {
			// Headphone transport — track its MAC for media sync.
			mac := extractMAC(string(info.Path))
			if mac != "" {
				pipelineMu.Lock()
				headphoneMAC = mac
				pipelineMu.Unlock()
				log.Info("headphone transport detected", "mac", mac)
			}
			return
		}

		// Sink transport = phone connected and streaming.
		// DON'T acquire the transport — let PipeWire handle it.
		sourceMAC := extractMAC(string(info.Path))
		if sourceMAC == "" {
			log.Error("could not extract MAC from transport path", "path", info.Path)
			return
		}

		// Debounce: skip if we already have a pipeline for this device.
		pipelineMu.Lock()
		if currentSourceMAC == sourceMAC && pipelineDone != nil {
			pipelineMu.Unlock()
			log.Debug("pipeline already running for this device, skipping", "mac", sourceMAC)
			return
		}
		pipelineMu.Unlock()

		// Stop any existing pipeline for a different device.
		stopPipeline()

		log.Info("phone connected, starting PipeWire pipeline", "mac", sourceMAC)

		pipelineMu.Lock()
		currentSourceMAC = sourceMAC
		pipelineDone = make(chan struct{})
		pipeDone := pipelineDone
		var pipeCtx context.Context
		pipeCtx, pipelineCancel = context.WithCancel(ctx)
		// Resolve headphone MAC: config takes priority, else use detected.
		hpMAC := cfg.Bluetooth.TargetHeadphone
		if hpMAC == "" {
			hpMAC = headphoneMAC
		}
		pipelineMu.Unlock()

		// Start volume and AVRCP sync if a headphone is connected.
		if hpMAC != "" {
			log.Info("starting media sync", "phone", sourceMAC, "headphone", hpMAC)
			avrcpSync := bt.NewAVRCPSync(
				adapter.Conn(),
				sourceMAC,
				hpMAC,
				adapter.SinkPath(),
				adapter.SourcePath(),
				log,
			)
			go avrcpSync.InitialVolumeSync()
			go avrcpSync.Run(pipeCtx)
		} else {
			log.Info("no headphone connected, skipping media sync")
		}

		// Start PipeWire capture — pw-cat records directly to WAV.
		go pwCapture.Run(pipeCtx, sourceMAC,
			cfg.Audio.SampleRate, cfg.Audio.Channels, cfg.Audio.BitDepth,
			pipeDone,
		)
	}

	onTransportRelease := func() {
		log.Info("transport released, stopping pipeline")
		pipelineMu.Lock()
		currentSourceMAC = ""
		pipelineMu.Unlock()
		stopPipeline()
	}

	// Watch for transport events via D-Bus (still needed to detect connections).
	go func() {
		if watchErr := adapter.WatchTransports(ctx, onTransportAcquire, onTransportRelease); watchErr != nil {
			log.Info("transport watcher stopped", "reason", watchErr)
		}
	}()

	// Start API server for the web control plane.
	apiServer := api.NewServer(cfg, adapter, sessMgr, log)
	go func() {
		if err := apiServer.Start(*apiAddr); err != nil && err != http.ErrServerClosed {
			log.Error("API server failed", "error", err)
		}
	}()

	log.Info("AluNotes bridge running — waiting for Bluetooth connections")

	// Wait for shutdown signal.
	<-ctx.Done()
	log.Info("shutting down...")
	stopPipeline()
	close(done)

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := apiServer.Shutdown(shutdownCtx); err != nil {
		log.Error("API server shutdown error", "error", err)
	}

	// Make adapter non-discoverable so phones can't connect after shutdown.
	if err := adapter.Teardown(); err != nil {
		log.Error("adapter teardown error", "error", err)
	}

	log.Info("goodbye")
}
