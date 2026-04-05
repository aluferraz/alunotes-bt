"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import { Headphones, Smartphone, Play, Loader2, Music, Phone } from "lucide-react";

export default function AudioBridgePage() {
  const queryClient = useQueryClient();
  
  // Status check to daemon (fails gracefully with ORPC)
  const { data: status, isLoading, error } = useQuery(orpc.bluetooth.status.queryOptions({
    refetchInterval: 3000,
    retry: false,
  }));

  const { data: recordings, isLoading: loadingRecordings } = useQuery(orpc.recordings.list.queryOptions());

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-12 h-12 text-primary animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto mt-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-manrope font-extrabold text-foreground tracking-tight">Audio Bridge</h1>
        <p className="text-muted-foreground text-lg">Manage Bluetooth devices and session recordings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <GlassCard className="p-8 flex flex-col gap-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 blur-3xl group-hover:bg-primary/40 transition-colors" />
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Smartphone className="w-6 h-6 text-primary" />
            Source Device
          </h2>
          
          <div className="flex flex-col gap-2 relative z-10">
            {status?.connectedSource?.connected ? (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]" />
                <span className="font-medium text-lg">{status.connectedSource.name}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                 <div className="flex items-center gap-3">
                   <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]" />
                   <span className="text-muted-foreground">Disconnected</span>
                 </div>
                 {error && <span className="text-xs text-red-400">Unable to reach bridge daemon.</span>}
              </div>
            )}
            <p className="text-sm text-muted-foreground">Bridges audio via BlueZ to your connected headphones.</p>
          </div>
        </GlassCard>

        <GlassCard className="p-8 flex flex-col gap-6 relative overflow-hidden group">
           <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/20 blur-3xl group-hover:bg-secondary/40 transition-colors" />
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Headphones className="w-6 h-6 text-secondary" />
            Output Device
          </h2>
          
          <div className="flex flex-col gap-2 relative z-10">
            {status?.connectedHeadphone?.connected ? (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]" />
                <span className="font-medium text-lg">{status.connectedHeadphone.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]" />
                <span className="text-muted-foreground">Disconnected</span>
              </div>
            )}
            <p className="text-sm text-muted-foreground">Receives A2DP and HFP audio from the source.</p>
          </div>
        </GlassCard>
      </div>

      <div className="flex flex-col gap-6 mt-8">
         <h2 className="text-2xl font-bold font-manrope">Recent Sessions & Highlights</h2>
         {loadingRecordings ? (
           <div className="h-32 bg-glass-border/50 animate-pulse rounded-3xl" />
         ) : recordings?.items?.length === 0 ? (
            <GlassCard className="p-12 text-center text-muted-foreground">
               No audio sessions recorded yet. Start streaming from your phone.
            </GlassCard>
         ) : (
            <div className="flex flex-col gap-4">
              {recordings?.items?.map((rec) => (
                <GlassCard key={rec.sessionId} className="p-6 flex items-center justify-between group hover:bg-glass-border/50 transition-colors">
                  <div className="flex items-center gap-6">
                    <div className="w-12 h-12 rounded-full bg-glass-bg border border-glass-border flex items-center justify-center relative overflow-hidden group-hover:bg-primary/20 transition-colors cursor-pointer text-primary">
                      <Play className="w-5 h-5 ml-1" />
                    </div>
                    <div className="flex flex-col">
                      <h3 className="font-semibold text-lg">{rec.label || rec.sessionId}</h3>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Music className="w-3 h-3" />
                          Audio Session
                        </span>
                        <span>{rec.date} {rec.time}</span>
                        <span>{rec.duration ? `${Math.floor(rec.duration / 60)}:${Math.floor(rec.duration % 60).toString().padStart(2, '0')}` : "Unknown length"}</span>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
         )}
      </div>
    </div>
  );
}
