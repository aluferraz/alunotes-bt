// Package config handles loading and providing application configuration.
package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Config holds all application configuration.
type Config struct {
	Bluetooth BluetoothConfig `yaml:"bluetooth"`
	Audio     AudioConfig     `yaml:"audio"`
	Session   SessionConfig   `yaml:"session"`
	Storage   StorageConfig   `yaml:"storage"`
}

// BluetoothConfig holds Bluetooth-related settings.
type BluetoothConfig struct {
	// AdapterName is the HCI adapter to use (e.g. "hci0").
	AdapterName string `yaml:"adapter_name"`
	// SinkName is the name advertised to source devices (e.g. phones).
	SinkName string `yaml:"sink_name"`
	// TargetHeadphone is the MAC address of the real headphone to forward audio to.
	TargetHeadphone string `yaml:"target_headphone"`
	// AutoConnect attempts to reconnect to the target headphone on startup.
	AutoConnect bool `yaml:"auto_connect"`
}

// AudioConfig holds audio pipeline settings.
type AudioConfig struct {
	// SampleRate in Hz for the PCM pipeline.
	SampleRate int `yaml:"sample_rate"`
	// Channels is the number of audio channels (1=mono, 2=stereo).
	Channels int `yaml:"channels"`
	// BitDepth is bits per sample (typically 16).
	BitDepth int `yaml:"bit_depth"`
	// BufferSize is the number of PCM frames per pipeline buffer.
	BufferSize int `yaml:"buffer_size"`
	// ChannelBuffer is the capacity of Go channel buffers between pipeline stages.
	ChannelBuffer int `yaml:"channel_buffer"`
}

// SessionConfig holds session lifecycle settings.
type SessionConfig struct {
	// IdleTimeout is how long silence must persist before ending a session.
	IdleTimeout time.Duration `yaml:"idle_timeout"`
	// SilenceThreshold is the PCM amplitude below which audio is considered silence.
	SilenceThreshold int `yaml:"silence_threshold"`
}

// StorageConfig holds audio storage settings.
type StorageConfig struct {
	// BaseDir is the root directory for session recordings.
	BaseDir string `yaml:"base_dir"`
	// Format is the output file format (currently "wav").
	Format string `yaml:"format"`
}

// Default returns a Config with sensible defaults.
func Default() Config {
	return Config{
		Bluetooth: BluetoothConfig{
			AdapterName: "hci0",
			SinkName:    "AluNotes Bridge",
			AutoConnect: true,
		},
		Audio: AudioConfig{
			SampleRate:    44100,
			Channels:      2,
			BitDepth:      16,
			BufferSize:    1024,
			ChannelBuffer: 64,
		},
		Session: SessionConfig{
			IdleTimeout:      30 * time.Second,
			SilenceThreshold: 100,
		},
		Storage: StorageConfig{
			BaseDir: "./recordings",
			Format:  "wav",
		},
	}
}

// Load reads configuration from the given YAML file path, falling back to
// defaults for any unset fields.
func Load(path string) (Config, error) {
	cfg := Default()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, fmt.Errorf("reading config file: %w", err)
	}

	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("parsing config file: %w", err)
	}

	return cfg, nil
}

// BytesPerFrame returns the number of bytes in a single PCM frame.
func (a *AudioConfig) BytesPerFrame() int {
	return a.Channels * (a.BitDepth / 8)
}

// BytesPerBuffer returns the total bytes for one pipeline buffer.
func (a *AudioConfig) BytesPerBuffer() int {
	return a.BufferSize * a.BytesPerFrame()
}
