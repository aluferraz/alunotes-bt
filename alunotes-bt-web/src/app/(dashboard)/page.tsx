"use client";

import { useQuery } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { BridgeStatusCard } from "./_components/bridge-status-card";
import { ConnectedDevicesCard } from "./_components/connected-devices-card";
import { ActiveSessionCard } from "./_components/active-session-card";
import { RecentRecordingsCard } from "./_components/recent-recordings-card";

export default function DashboardPage() {
  const statusQuery = useQuery({
    ...orpc.bluetooth.status.queryOptions(),
    refetchInterval: 3000,
  });
  const recordingsQuery = useQuery(
    orpc.recordings.list.queryOptions({ input: { limit: 5 } }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Monitor and control your Bluetooth audio bridge
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BridgeStatusCard
          status={statusQuery.data}
          isLoading={statusQuery.isLoading}
        />
        <ConnectedDevicesCard
          status={statusQuery.data}
          isLoading={statusQuery.isLoading}
        />
        <ActiveSessionCard
          status={statusQuery.data}
          isLoading={statusQuery.isLoading}
        />
      </div>

      <RecentRecordingsCard
        recordings={recordingsQuery.data?.items}
        isLoading={recordingsQuery.isLoading}
      />
    </div>
  );
}
