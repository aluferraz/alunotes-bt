// Package audio implements the concurrent audio pipeline.
//
// The pipeline has four concurrent stages connected by Go channels:
//   - Capture: reads PCM data from the Bluetooth transport file descriptor
//   - Route:   fans out audio buffers to the forwarder and the disk writer
//   - Forward: writes PCM data to the outbound Bluetooth transport
//   - Write:   saves audio data to disk as WAV files
package audio

import (
	"log/slog"

	"github.com/aluferraz/alunotes-bt/internal/config"
	"github.com/aluferraz/alunotes-bt/internal/session"
)

// Buffer is a chunk of PCM audio data flowing through the pipeline.
type Buffer struct {
	Data []byte
	Len  int // actual valid bytes in Data (may be less than cap)
}

// Pipeline orchestrates the concurrent audio processing stages.
type Pipeline struct {
	cfg     config.AudioConfig
	sessMgr *session.Manager
	log     *slog.Logger

	// Channels connecting pipeline stages.
	captured  chan Buffer // capture → route
	forward   chan Buffer // route → forward
	writeDisk chan Buffer // route → write
}

// NewPipeline creates a new audio processing pipeline.
func NewPipeline(cfg config.AudioConfig, sessMgr *session.Manager, logger *slog.Logger) *Pipeline {
	chanBuf := cfg.ChannelBuffer

	return &Pipeline{
		cfg:       cfg,
		sessMgr:   sessMgr,
		log:       logger.With("component", "audio.pipeline"),
		captured:  make(chan Buffer, chanBuf),
		forward:   make(chan Buffer, chanBuf),
		writeDisk: make(chan Buffer, chanBuf),
	}
}

// Captured returns the channel to send captured audio buffers into.
func (p *Pipeline) Captured() chan<- Buffer {
	return p.captured
}
