package audio

import (
	"log/slog"
	"os"
)

// Forward writes PCM audio buffers to the outbound Bluetooth transport file
// descriptor (the real headphone). It runs until the done channel is closed.
func Forward(fd int, in <-chan Buffer, done <-chan struct{}, log *slog.Logger) {
	log.Info("forward stage started", "fd", fd)
	defer log.Info("forward stage stopped")

	if fd <= 0 {
		log.Warn("no outbound transport fd, discarding forwarded audio")
		for {
			select {
			case <-done:
				return
			case _, ok := <-in:
				if !ok {
					return
				}
			}
		}
	}

	file := os.NewFile(uintptr(fd), "bt-transport-out")
	if file == nil {
		log.Error("invalid outbound transport file descriptor", "fd", fd)
		return
	}

	for {
		select {
		case <-done:
			return
		case buf, ok := <-in:
			if !ok {
				return
			}
			if _, err := file.Write(buf.Data[:buf.Len]); err != nil {
				log.Error("forward write error", "error", err)
				return
			}
		}
	}
}
