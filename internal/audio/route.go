package audio

import (
	"log/slog"
)

// Route reads from the captured channel and fans out each buffer to both the
// forward channel (for real-time playback) and the writeDisk channel (for
// recording). It prioritizes the forward path for minimum latency.
func Route(in <-chan Buffer, forward, writeDisk chan<- Buffer, done <-chan struct{}, log *slog.Logger) {
	log.Info("route stage started")
	defer log.Info("route stage stopped")

	for {
		select {
		case <-done:
			return
		case buf, ok := <-in:
			if !ok {
				return
			}

			// Copy data for the disk writer so the forwarder and writer
			// don't share the same backing array.
			diskBuf := Buffer{
				Data: make([]byte, buf.Len),
				Len:  buf.Len,
			}
			copy(diskBuf.Data, buf.Data[:buf.Len])

			// Send to forwarder first (latency-critical path).
			select {
			case forward <- buf:
			case <-done:
				return
			}

			// Send to disk writer (best-effort; drop if writer falls behind).
			select {
			case writeDisk <- diskBuf:
			default:
				log.Warn("disk writer falling behind, dropping buffer")
			}
		}
	}
}
