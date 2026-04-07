"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { AudioLines } from "lucide-react";
import { Switch } from "~/components/ui/switch";
import AluNotesLogo from "./alunotes-logo";

export function TopNavbar() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    ...orpc.bluetooth.status.queryOptions(),
    refetchInterval: 3000,
  });

  const autoRecordMutation = useMutation({
    ...orpc.bluetooth.setAutoRecord.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries(orpc.bluetooth.status.queryOptions());
    },
  });

  const autoRecord = statusQuery.data?.autoRecord ?? true;
  const isRecording = statusQuery.data?.activeSession != null;
  const bridgeRunning = statusQuery.data?.bridgeRunning ?? false;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-4 pt-4 sm:px-6 sm:pt-5">
      <nav className="mx-auto max-w-5xl glass-bg rounded-full px-5 py-2.5 flex items-center justify-between">
        {/* Branding */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-primary to-secondary">
            <AluNotesLogo className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-foreground select-none">
            AluNotes
          </span>
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-4">
          {/* Auto Recording Toggle */}
          <div className="flex items-center gap-2.5">
            <label
              htmlFor="auto-record-toggle"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase select-none cursor-pointer"
            >
              Auto Rec
            </label>
            <div className="relative">
              <Switch
                id="auto-record-toggle"
                checked={autoRecord}
                onCheckedChange={(checked: boolean) => {
                  autoRecordMutation.mutate({ enabled: checked });
                }}
                disabled={!bridgeRunning || autoRecordMutation.isPending}
                className={
                  autoRecord && isRecording
                    ? "data-checked:bg-red-500 data-checked:shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                    : ""
                }
              />
              {autoRecord && isRecording && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span>
              )}
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
