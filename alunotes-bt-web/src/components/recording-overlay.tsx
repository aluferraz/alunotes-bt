"use client";

import { useQuery } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic } from "lucide-react";
import { useEffect, useState } from "react";

export function RecordingOverlay() {
  const statusQuery = useQuery({
    ...orpc.bluetooth.status.queryOptions(),
    refetchInterval: 3000,
  });

  const isRecording = statusQuery.data?.activeSession != null;
  const duration = statusQuery.data?.activeSession?.duration ?? 0;

  const [localDuration, setLocalDuration] = useState(duration);

  // We only get duration every 3 seconds from the poll,
  // so we can interpolate the seconds locally to make it feel responsive.
  useEffect(() => {
    setLocalDuration(duration);
    
    if (!isRecording) return;
    
    const interval = setInterval(() => {
      setLocalDuration((prev) => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [duration, isRecording]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <AnimatePresence>
      {isRecording && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
        >
          <div className="bg-background/80 border border-red-500/30 rounded-full px-5 py-2.5 flex items-center gap-4 shadow-[0_0_30px_rgba(239,68,68,0.2)] backdrop-blur-xl">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"></span>
            </div>
            <span className="text-sm font-medium text-foreground tracking-wide flex items-center gap-2">
              <Mic className="w-4 h-4 text-red-500" />
              Recording
              <span className="font-mono text-red-500 ml-1">
                {formatDuration(localDuration)}
              </span>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
