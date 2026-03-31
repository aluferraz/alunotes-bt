// Command bridge is the main entrypoint for the AluNotes Bluetooth audio bridge.
//
// It sets up the Bluetooth adapter as an A2DP sink, optionally connects to a
// real headphone as an A2DP source, and runs a concurrent audio pipeline that
// proxies audio through while saving it to disk.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/aluferraz/alunotes-bt/internal/audio"
	"github.com/aluferraz/alunotes-bt/internal/bt"
	"github.com/aluferraz/alunotes-bt/internal/config"
	"github.com/aluferraz/alunotes-bt/internal/session"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to configuration file")
	flag.Parse()

	// Structured logger.
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
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

	// Connect to target headphone if configured.
	if cfg.Bluetooth.AutoConnect && cfg.Bluetooth.TargetHeadphone != "" {
		if err := adapter.ConnectHeadphone(ctx); err != nil {
			log.Warn("headphone connection failed (will retry on transport)", "error", err)
		}
	}

	// Session manager.
	sessMgr := session.NewManager(cfg.Session, cfg.Storage, log)

	// Audio writer.
	writer := audio.NewWriter(cfg.Audio, sessMgr, log)

	// Done channel for goroutine lifecycle.
	done := make(chan struct{})

	// Session end callback: log and prepare for next session.
	sessMgr.OnSessionEnd(func(s *session.Session) {
		log.Info("recording session completed", "id", s.ID, "dir", s.Dir)
	})

	// Start idle watcher.
	go sessMgr.RunIdleWatcher(done)

	// Pipeline stages will be started when a transport is acquired.
	var outboundFD int

	onTransportAcquire := func(info bt.TransportInfo) {
		fd, readMTU, _, acquireErr := adapter.AcquireTransport(info.Path)
		if acquireErr != nil {
			log.Error("failed to acquire transport", "error", acquireErr)
			return
		}

		log.Info("starting audio pipeline", "fd", fd, "mtu", readMTU)

		bufSize := int(readMTU)
		if bufSize == 0 {
			bufSize = cfg.Audio.BytesPerBuffer()
		}

		capturedCh := make(chan audio.Buffer, cfg.Audio.ChannelBuffer)
		forwardCh := make(chan audio.Buffer, cfg.Audio.ChannelBuffer)
		diskCh := make(chan audio.Buffer, cfg.Audio.ChannelBuffer)

		go audio.Capture(fd, bufSize, capturedCh, done, log)
		go audio.Route(capturedCh, forwardCh, diskCh, done, log)
		go audio.Forward(outboundFD, forwardCh, done, log)
		go writer.Run(diskCh, done)
	}

	onTransportRelease := func() {
		log.Info("transport released, pipeline will drain")
	}

	// Attempt to store outbound FD if headphone is connected.
	if cfg.Bluetooth.TargetHeadphone != "" {
		_ = outboundFD // will be set when outbound transport is acquired
	}

	// Watch for transport events (blocking).
	go func() {
		if watchErr := adapter.WatchTransports(ctx, onTransportAcquire, onTransportRelease); watchErr != nil {
			log.Info("transport watcher stopped", "reason", watchErr)
		}
	}()

	log.Info("AluNotes bridge running — waiting for Bluetooth connections")

	// Wait for shutdown signal.
	<-ctx.Done()
	log.Info("shutting down...")
	close(done)
	log.Info("goodbye")
}
