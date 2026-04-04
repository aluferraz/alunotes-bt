"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { client } from "~/orpc/client";
import { DeviceList } from "./_components/device-list";
import { AddDeviceDialog } from "./_components/add-device-dialog";

export default function DevicesPage() {
  const queryClient = useQueryClient();
  const devicesQuery = useQuery({
    ...orpc.bluetooth.devices.queryOptions(),
    refetchInterval: 3000,
  });

  const connectMutation = useMutation({
    mutationFn: (macAddress: string) =>
      client.bluetooth.connect({ macAddress }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.bluetooth.devices.queryOptions().queryKey,
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (macAddress: string) =>
      client.bluetooth.disconnect({ macAddress }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.bluetooth.devices.queryOptions().queryKey,
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => client.bluetooth.removeDevice({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.bluetooth.devices.queryOptions().queryKey,
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: {
      macAddress: string;
      name: string;
      type: "headphone" | "source";
      trusted?: boolean;
      notes?: string;
    }) => client.bluetooth.saveDevice(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.bluetooth.devices.queryOptions().queryKey,
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Devices</h1>
          <p className="text-sm text-muted-foreground">
            Manage your Bluetooth devices
          </p>
        </div>
        <AddDeviceDialog onSave={(data) => saveMutation.mutate(data)} />
      </div>

      <DeviceList
        devices={devicesQuery.data}
        isLoading={devicesQuery.isLoading}
        onConnect={(mac) => connectMutation.mutate(mac)}
        onDisconnect={(mac) => disconnectMutation.mutate(mac)}
        onRemove={(id) => removeMutation.mutate(id)}
        isConnecting={connectMutation.isPending}
        isDisconnecting={disconnectMutation.isPending}
      />
    </div>
  );
}
