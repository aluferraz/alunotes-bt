"use client";

import { Card as GlassCard } from "~/components/ui/glass/card";
import { Badge as GlassBadge } from "~/components/ui/glass/badge";
import { Button } from "~/components/ui/glass/button";
import { CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Headphones, Smartphone, Trash2, Plug, Unplug, Shield } from "lucide-react";

interface Device {
  id: string;
  macAddress: string;
  name: string;
  type: string;
  lastSeen: Date;
  trusted: boolean;
  notes: string | null;
  connected: boolean;
}

export function DeviceList({
  devices,
  isLoading,
  onConnect,
  onDisconnect,
  onRemove,
  isConnecting,
  isDisconnecting,
}: {
  devices?: Device[];
  isLoading: boolean;
  onConnect: (mac: string) => void;
  onDisconnect: (mac: string) => void;
  onRemove: (id: string) => void;
  isConnecting: boolean;
  isDisconnecting: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!devices || devices.length === 0) {
    return (
      <GlassCard>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Headphones className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No devices saved yet</p>
          <p className="text-xs text-muted-foreground/70">
            Add a device using the button above
          </p>
        </CardContent>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      {devices.map((device) => (
        <GlassCard key={device.id}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              {device.type === "headphone" ? (
                <Headphones className="h-5 w-5 text-primary" />
              ) : (
                <Smartphone className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{device.name}</span>
                {device.trusted && (
                  <Shield className="h-3.5 w-3.5 text-green-500" />
                )}
                <GlassBadge variant={device.connected ? "default" : "secondary"}>
                  {device.connected ? "Connected" : "Disconnected"}
                </GlassBadge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-mono">{device.macAddress}</span>
                <span>{device.type}</span>
              </div>
              {device.notes && (
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {device.notes}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {device.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDisconnect(device.macAddress)}
                  disabled={isDisconnecting}
                >
                  <Unplug className="mr-1 h-3.5 w-3.5" />
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onConnect(device.macAddress)}
                  disabled={isConnecting}
                >
                  <Plug className="mr-1 h-3.5 w-3.5" />
                  Connect
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(device.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </GlassCard>
      ))}
    </div>
  );
}
