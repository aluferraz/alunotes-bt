"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { client } from "~/orpc/client";
import { ProfileForm } from "./_components/profile-form";

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery(orpc.profile.get.queryOptions());

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; image?: string | null }) =>
      client.profile.update(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.profile.get.queryOptions().queryKey,
      });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account settings
        </p>
      </div>

      <ProfileForm
        profile={profileQuery.data}
        isLoading={profileQuery.isLoading}
        onSave={(data) => updateMutation.mutate(data)}
        isSaving={updateMutation.isPending}
      />
    </div>
  );
}
