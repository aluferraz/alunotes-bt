"use client";

import { Card as GlassCard } from "~/components/ui/glass/card";
import { Badge as GlassBadge } from "~/components/ui/glass/badge";
import { CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Bluetooth, Headphones, Smartphone } from "lucide-react";

interface DeviceStatus {
  name: string;
  mac: string;
  connected: boolean;
}

interface BridgeStatus {
  connectedSource: DeviceStatus | null;
  connectedHeadphone: DeviceStatus | null;
}

export function ConnectedDevicesCard({
  status,
  isLoading,
}: {
  status?: BridgeStatus;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <GlassCard>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Connected Devices</CardTitle>
        <Bluetooth className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <DeviceRow
          icon={<Smartphone className="h-4 w-4" />}
          label="Source"
          device={status?.connectedSource ?? null}
        />
        <DeviceRow
          icon={<Headphones className="h-4 w-4" />}
          label="Headphone"
          device={status?.connectedHeadphone ?? null}
        />
      </CardContent>
    </GlassCard>
  );
}

function DeviceRow({
  icon,
  label,
  device,
}: {
  icon: React.ReactNode;
  label: string;
  device: DeviceStatus | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 p-3">
      <div className="text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {device ? device.name : `No ${label.toLowerCase()}`}
        </div>
        {device && (
          <div className="text-xs font-mono text-muted-foreground">
            {device.mac}
          </div>
        )}
      </div>
      <GlassBadge variant={device?.connected ? "default" : "secondary"}>
        {device?.connected ? "Connected" : "Disconnected"}
      </GlassBadge>
    </div>
  );
}
