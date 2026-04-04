package sbc

/*
#cgo pkg-config: sbc
#include <sbc/sbc.h>
#include <stdlib.h>
*/
import "C"

import (
	"errors"
	"fmt"
	"sync"
	"unsafe"
)

// maxPCMPerFrame is the maximum PCM output size for a single SBC frame.
// SBC frames decode to at most ~512 bytes, but we allocate generously.
const maxPCMPerFrame = 4096

// Decoder wraps a libsbc sbc_t instance for decoding SBC frames to PCM.
// It is not safe for concurrent use; callers must synchronize externally.
type Decoder struct {
	mu      sync.Mutex
	sbc     C.sbc_t
	inited  bool
	decoded bool // true after at least one successful decode
}

// New creates and initializes a new SBC decoder.
func New() (*Decoder, error) {
	d := &Decoder{}
	ret := C.sbc_init(&d.sbc, 0)
	if ret < 0 {
		return nil, fmt.Errorf("sbc_init failed: %d", int(ret))
	}
	d.inited = true
	return d, nil
}

// Decode decodes a single SBC frame from the beginning of input.
// It returns the decoded PCM samples, the number of input bytes consumed,
// and any error. If input contains fewer bytes than a complete SBC frame,
// it returns (nil, 0, nil) — the caller should buffer and retry.
func (d *Decoder) Decode(input []byte) (pcm []byte, bytesConsumed int, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if !d.inited {
		return nil, 0, errors.New("decoder not initialized")
	}
	if len(input) == 0 {
		return nil, 0, nil
	}

	outBuf := make([]byte, maxPCMPerFrame)
	var written C.size_t

	ret := C.sbc_decode(
		&d.sbc,
		unsafe.Pointer(&input[0]),
		C.size_t(len(input)),
		unsafe.Pointer(&outBuf[0]),
		C.size_t(maxPCMPerFrame),
		&written,
	)
	if ret < 0 {
		// Negative return means error; -1 often means incomplete frame.
		if ret == -1 || ret == -2 {
			// Not enough data for a complete frame.
			return nil, 0, nil
		}
		return nil, 0, fmt.Errorf("sbc_decode error: %d", int(ret))
	}

	d.decoded = true
	consumed := int(ret)
	return outBuf[:int(written)], consumed, nil
}

// DecodeAll decodes all complete SBC frames in the input buffer and returns
// the concatenated PCM output. Partial trailing frames are silently ignored;
// the caller should prepend unconsumed bytes to the next read.
// Returns (pcm, error) where pcm may be nil if no complete frames were found.
func (d *Decoder) DecodeAll(input []byte) (pcm []byte, err error) {
	var result []byte
	offset := 0

	for offset < len(input) {
		p, consumed, decErr := d.Decode(input[offset:])
		if decErr != nil {
			return result, fmt.Errorf("decode at offset %d: %w", offset, decErr)
		}
		if consumed == 0 {
			// Remaining bytes are an incomplete frame.
			break
		}
		if len(p) > 0 {
			result = append(result, p...)
		}
		offset += consumed
	}

	return result, nil
}

// SampleRate returns the sample rate of the decoded audio in Hz.
// Only valid after at least one successful Decode call.
func (d *Decoder) SampleRate() int {
	d.mu.Lock()
	defer d.mu.Unlock()

	switch d.sbc.frequency {
	case C.SBC_FREQ_16000:
		return 16000
	case C.SBC_FREQ_32000:
		return 32000
	case C.SBC_FREQ_44100:
		return 44100
	case C.SBC_FREQ_48000:
		return 48000
	default:
		return 0
	}
}

// Channels returns the number of audio channels (1 for mono, 2 for stereo).
// Only valid after at least one successful Decode call.
func (d *Decoder) Channels() int {
	d.mu.Lock()
	defer d.mu.Unlock()

	switch d.sbc.mode {
	case C.SBC_MODE_MONO:
		return 1
	default:
		// DUAL_CHANNEL, STEREO, and JOINT_STEREO are all 2-channel.
		return 2
	}
}

// Close releases the libsbc resources. The decoder must not be used after Close.
func (d *Decoder) Close() {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.inited {
		C.sbc_finish(&d.sbc)
		d.inited = false
	}
}
