"use client";

import { Card as GlassCard } from "~/components/ui/glass/card";
import { Badge as GlassBadge } from "~/components/ui/glass/badge";
import { CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Radio, Wifi } from "lucide-react";

interface BridgeStatus {
  bridgeRunning: boolean;
  discoverable: boolean;
  sinkAdapter: string;
  sourceAdapter: string;
  dualMode: boolean;
  sinkName: string;
}

export function BridgeStatusCard({
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
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-36" />
        </CardContent>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Bridge Status</CardTitle>
        <Radio className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <GlassBadge variant={status?.bridgeRunning ? "default" : "destructive"}>
            {status?.bridgeRunning ? "Running" : "Stopped"}
          </GlassBadge>
          {status?.dualMode && (
            <GlassBadge variant="outline">Dual Adapter</GlassBadge>
          )}
        </div>
        {status?.sinkName && (
          <div className="flex items-center gap-2 text-sm">
            <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">
              {status.discoverable ? "Advertising as" : "Not advertising"}
            </span>
            {status.discoverable && (
              <span className="font-mono text-xs">{status.sinkName}</span>
            )}
          </div>
        )}
        {status?.sinkAdapter && (
          <div className="text-xs text-muted-foreground">
            Sink: {status.sinkAdapter}
            {status.sourceAdapter && ` / Source: ${status.sourceAdapter}`}
          </div>
        )}
      </CardContent>
    </GlassCard>
  );
}
