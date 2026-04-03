"use client";

import { useState, useEffect } from "react";
import { Card as GlassCard } from "~/components/ui/glass/card";
import { Button } from "~/components/ui/glass/button";
import { Input } from "~/components/ui/glass/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Bluetooth, AudioLines, Timer, HardDrive, Save } from "lucide-react";

interface BridgeConfig {
  bluetooth: {
    sink_adapter: string;
    source_adapter: string;
    sink_name: string;
    target_headphone: string;
    auto_connect: boolean;
    device_id_file: string;
  };
  audio: {
    sample_rate: number;
    channels: number;
    bit_depth: number;
    buffer_size: number;
    channel_buffer: number;
  };
  session: {
    idle_timeout: string;
    silence_threshold: number;
  };
  storage: {
    base_dir: string;
    format: string;
  };
}

export function SettingsForm({
  config,
  isLoading,
  onSave,
  isSaving,
}: {
  config?: BridgeConfig;
  isLoading: boolean;
  onSave: (data: Partial<BridgeConfig>) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<BridgeConfig | null>(null);

  useEffect(() => {
    if (config && !form) {
      setForm(config);
    }
  }, [config, form]);

  if (isLoading || !form) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  const handleSave = () => {
    onSave(form);
  };

  return (
    <div className="space-y-6">
      {/* Bluetooth Settings */}
      <GlassCard>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Bluetooth className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">Bluetooth</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Sink Adapter</Label>
            <Input
              value={form.bluetooth.sink_adapter}
              onChange={(e) =>
                setForm({
                  ...form,
                  bluetooth: {
                    ...form.bluetooth,
                    sink_adapter: e.target.value,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Source Adapter</Label>
            <Input
              value={form.bluetooth.source_adapter}
              onChange={(e) =>
                setForm({
                  ...form,
                  bluetooth: {
                    ...form.bluetooth,
                    source_adapter: e.target.value,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Sink Name</Label>
            <Input
              value={form.bluetooth.sink_name}
              onChange={(e) =>
                setForm({
                  ...form,
                  bluetooth: {
                    ...form.bluetooth,
                    sink_name: e.target.value,
                  },
                })
              }
              placeholder="Auto-generated if empty"
            />
          </div>
          <div className="space-y-2">
            <Label>Target Headphone MAC</Label>
            <Input
              value={form.bluetooth.target_headphone}
              onChange={(e) =>
                setForm({
                  ...form,
                  bluetooth: {
                    ...form.bluetooth,
                    target_headphone: e.target.value,
                  },
                })
              }
              placeholder="AA:BB:CC:DD:EE:FF"
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              checked={form.bluetooth.auto_connect}
              onCheckedChange={(checked) =>
                setForm({
                  ...form,
                  bluetooth: {
                    ...form.bluetooth,
                    auto_connect: checked,
                  },
                })
              }
            />
            <Label>Auto-connect to headphone on startup</Label>
          </div>
        </CardContent>
      </GlassCard>

      {/* Audio Settings */}
      <GlassCard>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <AudioLines className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">Audio</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Sample Rate</Label>
            <Select
              value={String(form.audio.sample_rate)}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  audio: { ...form.audio, sample_rate: Number(v ?? form.audio.sample_rate) },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="44100">44100 Hz</SelectItem>
                <SelectItem value="48000">48000 Hz</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Channels</Label>
            <Select
              value={String(form.audio.channels)}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  audio: { ...form.audio, channels: Number(v ?? form.audio.channels) },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Mono</SelectItem>
                <SelectItem value="2">Stereo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Bit Depth</Label>
            <Select
              value={String(form.audio.bit_depth)}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  audio: { ...form.audio, bit_depth: Number(v ?? form.audio.bit_depth) },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="16">16-bit</SelectItem>
                <SelectItem value="24">24-bit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Buffer Size (frames)</Label>
            <Input
              type="number"
              value={form.audio.buffer_size}
              onChange={(e) =>
                setForm({
                  ...form,
                  audio: {
                    ...form.audio,
                    buffer_size: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        </CardContent>
      </GlassCard>

      {/* Session Settings */}
      <GlassCard>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Timer className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">Session</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Idle Timeout</Label>
            <Input
              value={form.session.idle_timeout}
              onChange={(e) =>
                setForm({
                  ...form,
                  session: {
                    ...form.session,
                    idle_timeout: e.target.value,
                  },
                })
              }
              placeholder="30s"
            />
          </div>
          <div className="space-y-2">
            <Label>Silence Threshold</Label>
            <Input
              type="number"
              value={form.session.silence_threshold}
              onChange={(e) =>
                setForm({
                  ...form,
                  session: {
                    ...form.session,
                    silence_threshold: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        </CardContent>
      </GlassCard>

      {/* Storage Settings */}
      <GlassCard>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <HardDrive className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">Storage</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Base Directory</Label>
            <Input
              value={form.storage.base_dir}
              onChange={(e) =>
                setForm({
                  ...form,
                  storage: { ...form.storage, base_dir: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Format</Label>
            <Select
              value={form.storage.format}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  storage: { ...form.storage, format: v ?? "wav" },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wav">WAV</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </GlassCard>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          <Save className="mr-1 h-4 w-4" />
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
