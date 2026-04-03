"use client";

import Link from "next/link";
import { Card as GlassCard } from "~/components/ui/glass/card";
import { CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Clock, HardDrive, ArrowRight, Star } from "lucide-react";

interface Recording {
  sessionId: string;
  date: string;
  time: string;
  fileSize: number;
  duration: number | null;
  favorite: boolean;
  label: string | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecentRecordingsCard({
  recordings,
  isLoading,
}: {
  recordings?: Recording[];
  isLoading: boolean;
}) {
  return (
    <GlassCard>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">
          Recent Recordings
        </CardTitle>
        <Link
          href="/recordings"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          View All <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : recordings && recordings.length > 0 ? (
          <div className="space-y-2">
            {recordings.map((rec) => (
              <Link
                key={rec.sessionId}
                href={`/recordings?session=${rec.sessionId}`}
                className="flex items-center gap-3 rounded-lg border border-border/40 p-3 transition-colors hover:bg-accent/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {rec.label ?? rec.sessionId}
                    </span>
                    {rec.favorite && (
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {rec.duration ? formatDuration(rec.duration) : "--:--"}
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      {formatSize(rec.fileSize)}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {rec.date}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No recordings yet
          </p>
        )}
      </CardContent>
    </GlassCard>
  );
}
