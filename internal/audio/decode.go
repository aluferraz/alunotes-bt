package audio

import (
	"fmt"
	"log/slog"
)

// Passthrough forwards buffers from in to out without transformation.
// Logs diagnostic info about the first packet to help identify the audio format.
func Passthrough(in <-chan Buffer, out chan<- Buffer, done <-chan struct{}, log *slog.Logger) {
	log.Info("passthrough stage started")
	defer log.Info("passthrough stage stopped")

	logged := false
	for {
		select {
		case <-done:
			return
		case buf, ok := <-in:
			if !ok {
				return
			}

			if !logged {
				logged = true
				data := buf.Data[:buf.Len]

				// Log first 64 bytes.
				n := 64
				if len(data) < n {
					n = len(data)
				}
				log.Info("first audio packet",
					"len", buf.Len,
					"header", fmt.Sprintf("%02x", data[:n]),
				)

				// Scan for SBC sync byte 0x9C.
				for i, b := range data {
					if b == 0x9C {
						log.Info("found SBC sync byte", "offset", i)
						break
					}
					if i == len(data)-1 {
						log.Info("no SBC sync byte (0x9C) found in packet")
					}
				}
			}

			select {
			case out <- buf:
			default:
				log.Warn("PCM writer falling behind, dropping buffer")
			}
		}
	}
}
