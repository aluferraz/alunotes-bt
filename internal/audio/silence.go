package audio

import (
	"math"
)

// IsSilent returns true if the PCM buffer (16-bit little-endian samples) has
// a peak amplitude below the given threshold. This is used for idle detection.
func IsSilent(data []byte, length int, threshold int) bool {
	if length < 2 {
		return true
	}

	peak := 0
	for i := 0; i+1 < length; i += 2 {
		sample := int(int16(data[i]) | int16(data[i+1])<<8)
		abs := int(math.Abs(float64(sample)))
		if abs > peak {
			peak = abs
		}
	}

	return peak < threshold
}
