"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { client } from "~/orpc/client";
import { SettingsForm } from "./_components/settings-form";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(orpc.settings.get.queryOptions());

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof client.settings.update>[0]) =>
      client.settings.update(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.settings.get.queryOptions().queryKey,
      });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure the Bluetooth audio bridge
        </p>
      </div>

      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
        Changes to settings require restarting the bridge daemon to take effect.
      </div>

      <SettingsForm
        config={settingsQuery.data}
        isLoading={settingsQuery.isLoading}
        onSave={(data) => updateMutation.mutate(data)}
        isSaving={updateMutation.isPending}
      />
    </div>
  );
}
