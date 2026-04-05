"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { client } from "~/orpc/client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Plus, Loader2, Bluetooth, Signal, Square } from "lucide-react";

const SCAN_DURATION_MS = 3 * 60 * 1000; // 3 minutes

interface ScannedDevice {
  name: string;
  mac: string;
  rssi: number;
  connected: boolean;
  paired: boolean;
}

export function AddDeviceDialog({
  onSave,
}: {
  onSave: (data: {
    macAddress: string;
    name: string;
    type: "headphone" | "source";
    notes?: string;
  }) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<ScannedDevice | null>(
    null,
  );
  const [name, setName] = useState("");
  const [type, setType] = useState<"headphone" | "source">("headphone");
  const [notes, setNotes] = useState("");

  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopScan = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
    setScanning(false);
  }, []);

  const startScan = useCallback(() => {
    setDevices([]);
    setScanning(true);

    const poll = async () => {
      try {
        const result = await client.bluetooth.scan();
        setDevices((prev) => {
          const merged = new Map(prev.map((d) => [d.mac, d]));
          for (const d of result) {
            const existing = merged.get(d.mac);
            // Update if new or has better info (name appeared, rssi changed)
            if (!existing || d.name || d.rssi < existing.rssi) {
              merged.set(d.mac, {
                ...d,
                // Keep name if we had it and new result lost it
                name: d.name ?? existing?.name ?? "",
              });
            }
          }
          return Array.from(merged.values());
        });
      } catch {
        // Daemon unreachable, keep going
      }
    };

    // Poll immediately, then every 8s (scan takes ~5s on the Go side)
    void poll();
    intervalRef.current = setInterval(() => void poll(), 8000);

    // Auto-stop after 3 minutes
    timeoutRef.current = setTimeout(stopScan, SCAN_DURATION_MS);
  }, [stopScan]);

  // Start scanning when dialog opens
  useEffect(() => {
    if (open && !selectedDevice) {
      startScan();
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [open, selectedDevice, startScan]);

  const handleSelectDevice = (device: ScannedDevice) => {
    stopScan();
    setSelectedDevice(device);
    setName(device.name || device.mac);
  };

  const handleSave = () => {
    if (!selectedDevice) return;
    onSave({
      macAddress: selectedDevice.mac,
      name,
      type,
      notes: notes || undefined,
    });
    resetAndClose();
  };

  const resetAndClose = () => {
    stopScan();
    setSelectedDevice(null);
    setName("");
    setType("headphone");
    setNotes("");
    setDevices([]);
    setOpen(false);
    // Clear any cached scan results
    void queryClient.invalidateQueries({ queryKey: ["bluetooth", "scan"] });
  };

  const named = devices.filter((d) => d.name).sort((a, b) => b.rssi - a.rssi);
  const unnamed = devices
    .filter((d) => !d.name)
    .sort((a, b) => b.rssi - a.rssi);

  const DeviceButton = ({ device }: { device: ScannedDevice }) => (
    <button
      className="flex w-full items-center gap-3 rounded-lg border border-border/40 p-3 text-left transition-colors hover:bg-accent/50"
      onClick={() => handleSelectDevice(device)}
    >
      <Bluetooth className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {device.name || device.mac}
        </p>
        <p className="text-xs text-muted-foreground">
          {device.mac}
          {device.paired && " · Paired"}
          {device.connected && " · Connected"}
        </p>
      </div>
      {device.rssi !== 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Signal className="h-3 w-3" />
          {device.rssi} dBm
        </div>
      )}
    </button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setOpen(true);
        } else {
          resetAndClose();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button className="rounded-full shadow-glass-sm bg-primary/20 text-primary hover:bg-primary/30">
            <Plus className="mr-1 h-4 w-4" />
            Add Device
          </Button>
        }
      />
      <DialogContent className="border-glass-border bg-glass-bg backdrop-blur-xl shadow-glass max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Device</DialogTitle>
          <DialogDescription>
            {selectedDevice
              ? "Configure the selected device."
              : scanning
                ? "Scanning for nearby Bluetooth devices..."
                : "Scan complete."}
          </DialogDescription>
        </DialogHeader>

        {!selectedDevice ? (
          <div className="space-y-2 py-2">
            {scanning && devices.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning for devices...
              </div>
            )}

            {!scanning && devices.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No devices found. Make sure the device is in pairing mode.
              </div>
            )}

            {devices.length > 0 && (
              <div className="space-y-3">
                {scanning && (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Scanning...
                  </div>
                )}
                {named.length > 0 && (
                  <div className="space-y-1">
                    {named.map((device) => (
                      <DeviceButton key={device.mac} device={device} />
                    ))}
                  </div>
                )}
                {unnamed.length > 0 && (
                  <div className="space-y-1">
                    <p className="px-1 text-xs font-medium text-muted-foreground">
                      Other devices ({unnamed.length})
                    </p>
                    <div className="max-h-32 space-y-1 overflow-y-auto">
                      {unnamed.map((device) => (
                        <DeviceButton key={device.mac} device={device} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-center gap-2 pt-2">
              {scanning ? (
                <Button variant="outline" size="sm" onClick={stopScan}>
                  <Square className="mr-1 h-3 w-3" />
                  Stop
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={startScan}>
                  <Bluetooth className="mr-1 h-3 w-3" />
                  Scan Again
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-sm font-medium">
                {selectedDevice.name || selectedDevice.mac}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedDevice.mac}
              </p>
            </div>
            <div className="space-y-2 flex flex-col items-start gap-1">
              <Label htmlFor="name">Device Name</Label>
              <Input
                id="name"
                placeholder="My Headphones"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2 flex flex-col items-start gap-1">
              <Label>Device Type</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  if (v === "headphone" || v === "source") setType(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="headphone">Headphone</SelectItem>
                  <SelectItem value="source">Source (Phone/Laptop)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex flex-col items-start gap-1">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                placeholder="Optional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {selectedDevice ? (
            <>
              <Button
                variant="outline"
                className="bg-transparent border-glass-border"
                onClick={() => {
                  setSelectedDevice(null);
                  setName("");
                  setType("headphone");
                  setNotes("");
                }}
              >
                Back
              </Button>
              <Button onClick={handleSave} disabled={!name}>
                Save Device
              </Button>
            </>
          ) : (
            <Button variant="outline" className="bg-transparent border-glass-border" onClick={resetAndClose}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
