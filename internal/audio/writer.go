package audio

import (
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/aluferraz/alunotes-bt/internal/config"
	"github.com/aluferraz/alunotes-bt/internal/session"
)

// Writer saves audio buffers to disk as WAV files. It touches the session
// manager on each buffer to signal audio activity for idle detection.
type Writer struct {
	cfg     config.AudioConfig
	sessMgr *session.Manager
	log     *slog.Logger

	bytesWritten atomic.Int64
}

// NewWriter creates a new disk Writer.
func NewWriter(cfg config.AudioConfig, sessMgr *session.Manager, logger *slog.Logger) *Writer {
	return &Writer{
		cfg:     cfg,
		sessMgr: sessMgr,
		log:     logger.With("component", "audio.writer"),
	}
}

// Run reads buffers from in and writes them to a WAV file in the current session
// directory. It blocks until done is closed or in is closed.
func (w *Writer) Run(in <-chan Buffer, done <-chan struct{}) {
	w.log.Info("writer stage started")
	defer w.log.Info("writer stage stopped")

	var (
		currentFile *os.File
		currentSess *session.Session
	)

	defer func() {
		if currentFile != nil {
			w.finalizeWAV(currentFile)
			currentFile.Close()
		}
	}()

	for {
		select {
		case <-done:
			return
		case buf, ok := <-in:
			if !ok {
				return
			}

			// Signal activity to session manager.
			sess, err := w.sessMgr.Touch()
			if err != nil {
				w.log.Error("session touch error", "error", err)
				continue
			}

			// Open a new file if session changed.
			if currentSess == nil || currentSess.ID != sess.ID {
				if currentFile != nil {
					w.finalizeWAV(currentFile)
					currentFile.Close()
				}
				currentFile, err = w.openWAV(sess)
				if err != nil {
					w.log.Error("failed to open WAV file", "error", err)
					continue
				}
				currentSess = sess
				w.bytesWritten.Store(0)
			}

			n, err := currentFile.Write(buf.Data[:buf.Len])
			if err != nil {
				w.log.Error("disk write error", "error", err)
				continue
			}
			w.bytesWritten.Add(int64(n))
		}
	}
}

func (w *Writer) openWAV(sess *session.Session) (*os.File, error) {
	path := filepath.Join(sess.Dir, "recording.wav")
	f, err := os.Create(path)
	if err != nil {
		return nil, fmt.Errorf("creating WAV file: %w", err)
	}

	w.log.Info("opened WAV file", "path", path)

	// Write a placeholder WAV header; we'll update sizes on finalize.
	header := makeWAVHeader(w.cfg, 0)
	if _, err := f.Write(header); err != nil {
		f.Close()
		return nil, fmt.Errorf("writing WAV header: %w", err)
	}

	return f, nil
}

func (w *Writer) finalizeWAV(f *os.File) {
	dataSize := uint32(w.bytesWritten.Load())
	if dataSize == 0 {
		return
	}

	// Update RIFF chunk size.
	if _, err := f.Seek(4, io.SeekStart); err != nil {
		w.log.Error("WAV finalize seek error", "error", err)
		return
	}
	riffSize := 36 + dataSize
	if err := binary.Write(f, binary.LittleEndian, riffSize); err != nil {
		w.log.Error("WAV finalize RIFF size error", "error", err)
		return
	}

	// Update data chunk size.
	if _, err := f.Seek(40, io.SeekStart); err != nil {
		w.log.Error("WAV finalize data seek error", "error", err)
		return
	}
	if err := binary.Write(f, binary.LittleEndian, dataSize); err != nil {
		w.log.Error("WAV finalize data size error", "error", err)
		return
	}

	w.log.Info("WAV finalized", "dataBytes", dataSize, "path", f.Name())
}

// makeWAVHeader creates a 44-byte WAV header for the given audio config.
func makeWAVHeader(cfg config.AudioConfig, dataSize uint32) []byte {
	h := make([]byte, 44)
	byteRate := uint32(cfg.SampleRate * cfg.Channels * (cfg.BitDepth / 8))
	blockAlign := uint16(cfg.Channels * (cfg.BitDepth / 8))

	// RIFF header
	copy(h[0:4], "RIFF")
	binary.LittleEndian.PutUint32(h[4:8], 36+dataSize)
	copy(h[8:12], "WAVE")

	// fmt sub-chunk
	copy(h[12:16], "fmt ")
	binary.LittleEndian.PutUint32(h[16:20], 16) // sub-chunk size
	binary.LittleEndian.PutUint16(h[20:22], 1)  // PCM format
	binary.LittleEndian.PutUint16(h[22:24], uint16(cfg.Channels))
	binary.LittleEndian.PutUint32(h[24:28], uint32(cfg.SampleRate))
	binary.LittleEndian.PutUint32(h[28:32], byteRate)
	binary.LittleEndian.PutUint16(h[32:34], blockAlign)
	binary.LittleEndian.PutUint16(h[34:36], uint16(cfg.BitDepth))

	// data sub-chunk
	copy(h[36:40], "data")
	binary.LittleEndian.PutUint32(h[40:44], dataSize)

	return h
}
