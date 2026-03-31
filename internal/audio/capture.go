package audio

import (
	"log/slog"
	"os"
)

// Capture reads PCM data from a Bluetooth transport file descriptor and sends
// buffers into the pipeline. It runs until the done channel is closed or a
// read error occurs.
func Capture(fd int, bufSize int, out chan<- Buffer, done <-chan struct{}, log *slog.Logger) {
	file := os.NewFile(uintptr(fd), "bt-transport-in")
	if file == nil {
		log.Error("invalid transport file descriptor", "fd", fd)
		return
	}

	log.Info("capture stage started", "fd", fd, "bufSize", bufSize)

	for {
		select {
		case <-done:
			log.Info("capture stage stopped")
			return
		default:
		}

		buf := make([]byte, bufSize)
		n, err := file.Read(buf)
		if err != nil {
			log.Error("capture read error", "error", err)
			return
		}
		if n == 0 {
			continue
		}

		select {
		case out <- Buffer{Data: buf, Len: n}:
		case <-done:
			log.Info("capture stage stopped")
			return
		}
	}
}
