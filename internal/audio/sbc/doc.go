// Package sbc provides SBC (Sub-Band Codec) audio decoding via cgo bindings
// to libsbc. SBC is the mandatory codec for Bluetooth A2DP audio streaming.
//
// BlueZ A2DP MediaTransport1 file descriptors deliver SBC-encoded frames, not
// raw PCM. This package decodes SBC frames into signed 16-bit little-endian
// PCM suitable for WAV file recording.
//
// Build requirements:
//
//	apt install libsbc-dev
//
// The package links against libsbc using pkg-config. If pkg-config metadata
// is not available, set CGO_CFLAGS="-I/usr/include" and
// CGO_LDFLAGS="-lsbc" manually.
package sbc
