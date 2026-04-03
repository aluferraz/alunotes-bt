"use client";

import { Card as GlassCard } from "~/components/ui/glass/card";
import { Badge as GlassBadge } from "~/components/ui/glass/badge";
import { CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Mic } from "lucide-react";

interface BridgeStatus {
  activeSession: {
    id: string;
    startedAt: string;
    duration: number;
  } | null;
  pipelineActive: boolean;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ActiveSessionCard({
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
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </GlassCard>
    );
  }

  const session = status?.activeSession;

  return (
    <GlassCard>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Active Session</CardTitle>
        <Mic className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {session ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              <GlassBadge variant="destructive">Recording</GlassBadge>
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatDuration(session.duration)}
            </div>
            <div className="text-xs text-muted-foreground">
              Session: {session.id}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <Mic className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No active session</p>
            <p className="text-xs text-muted-foreground/70">
              Waiting for audio input...
            </p>
          </div>
        )}
      </CardContent>
    </GlassCard>
  );
}
