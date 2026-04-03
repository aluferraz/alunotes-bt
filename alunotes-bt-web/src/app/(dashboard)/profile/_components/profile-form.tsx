"use client";

import { useState, useEffect } from "react";
import { Card as GlassCard } from "~/components/ui/glass/card";
import { Badge as GlassBadge } from "~/components/ui/glass/badge";
import { Button } from "~/components/ui/glass/button";
import { Input } from "~/components/ui/glass/input";
import { Label } from "~/components/ui/label";
import { CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Save } from "lucide-react";

interface Profile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  providers: string[];
  createdAt: string;
}

export function ProfileForm({
  profile,
  isLoading,
  onSave,
  isSaving,
}: {
  profile?: Profile;
  isLoading: boolean;
  onSave: (data: { name?: string }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (profile) {
      setName(profile.name);
    }
  }, [profile]);

  if (isLoading || !profile) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <GlassCard>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile.image ?? undefined} />
              <AvatarFallback className="text-lg">
                {profile.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{profile.name}</p>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile.email} disabled />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed
              </p>
            </div>

            <div className="space-y-2">
              <Label>Auth Providers</Label>
              <div className="flex gap-2">
                {profile.providers.map((provider) => (
                  <GlassBadge key={provider} variant="outline">
                    {provider}
                  </GlassBadge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Member Since</Label>
              <p className="text-sm text-muted-foreground">
                {new Date(profile.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => onSave({ name })}
              disabled={isSaving || name === profile.name}
            >
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </GlassCard>
    </div>
  );
}
