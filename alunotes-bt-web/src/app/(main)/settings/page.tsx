"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import { Shield, KeyRound, Headphones, User, Trash2, Link as LinkIcon, Unlink, Sun, Moon, RotateCcw, Music } from "lucide-react";
import { AddDeviceDialog } from "~/components/add-device-dialog";
import { Button } from "~/components/ui/button";
import { useUIPreferences } from "~/stores/ui-preferences";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(orpc.profile.get.queryOptions());
  const { data: devices, isLoading: isDevicesLoading } = useQuery(orpc.bluetooth.devices.queryOptions());
  const { data: trashedRecordings } = useQuery(orpc.recordings.listTrashed.queryOptions());

  const invalidateTrash = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.recordings.listTrashed.queryOptions().queryKey });
    void queryClient.invalidateQueries({ queryKey: orpc.recordings.list.queryOptions().queryKey });
  };

  const restoreMut = useMutation({
    ...orpc.recordings.restore.mutationOptions(),
    onSuccess: invalidateTrash,
  });

  const deletePermanentMut = useMutation({
    ...orpc.recordings.deletePermanent.mutationOptions(),
    onSuccess: invalidateTrash,
  });

  const emptyTrashMut = useMutation({
    ...orpc.recordings.emptyTrash.mutationOptions(),
    onSuccess: invalidateTrash,
  });

  const invalidateBluetooth = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.bluetooth.devices.queryOptions().queryKey });
    void queryClient.invalidateQueries({ queryKey: orpc.bluetooth.status.queryOptions().queryKey });
  };

  const saveDeviceMut = useMutation({
    ...orpc.bluetooth.saveDevice.mutationOptions(),
    onSuccess: invalidateBluetooth,
  });

  const removeDeviceMut = useMutation({
    ...orpc.bluetooth.removeDevice.mutationOptions(),
    onSuccess: invalidateBluetooth,
  });

  const connectDeviceMut = useMutation({
    ...orpc.bluetooth.connect.mutationOptions(),
    onSuccess: invalidateBluetooth,
  });

  const { theme, setTheme } = useUIPreferences();
  const isDark = theme === "dark";

  return (
    <div className="flex flex-col gap-8 max-w-3xl mx-auto">
       <div className="flex flex-col gap-2">
         <h1 className="text-4xl font-extrabold text-foreground tracking-tight">Settings & Privacy</h1>
         <p className="text-muted-foreground text-lg">Manage your devices, security, and preferences.</p>
       </div>

       <div className="grid grid-cols-1 gap-6">
         
         <GlassCard className="p-8">
            <h2 className="text-2xl font-bold flex items-center gap-3 mb-6">
              <User className="w-5 h-5 text-primary" />
              Account
            </h2>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-semibold">{user?.name || "Not logged in"}</span>
                <span className="text-muted-foreground text-sm">{user?.email || "Local / Anonymous Mode"}</span>
              </div>
              <Button variant="outline" className="rounded-full shadow-glass-sm" onClick={() => alert("Sign in flow not implemented yet.")}>
                 {user && user.email !== "anonymous@example.com" ? "Sign Out" : "Sign In"}
              </Button>
            </div>
         </GlassCard>

         <GlassCard className="p-8">
            <div className="flex items-center justify-between mb-6">
               <h2 className="text-2xl font-bold flex items-center gap-3">
                 <Headphones className="w-5 h-5 text-secondary" />
                 Trusted Devices
               </h2>
               <AddDeviceDialog 
                 onSave={(data) => {
                   saveDeviceMut.mutate({
                     ...data,
                     trusted: true,
                   });
                 }} 
               />
            </div>
            
            <div className="flex flex-col gap-3">
               {isDevicesLoading ? (
                 <div className="text-muted-foreground text-sm flex items-center gap-2">Loading devices...</div>
               ) : devices?.length === 0 ? (
                 <div className="text-muted-foreground text-sm">No trusted devices managed yet. Add your headphones or phone to begin.</div>
               ) : (
                 devices?.map((dev) => (
                   <div key={dev.id} className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-glass-border">
                     <div className="flex flex-col">
                        <span className="font-semibold text-foreground flex items-center gap-2">
                           {dev.name}
                           {dev.connected && (
                             <span className="bg-green-500/20 text-green-500 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Connected</span>
                           )}
                        </span>
                        <span className="text-xs text-muted-foreground uppercase">{dev.macAddress} • {dev.type}</span>
                     </div>
                     <div className="flex items-center gap-2">
                        {dev.connected ? (
                           <button 
                              className="w-10 h-10 rounded-full border border-glass-border flex items-center justify-center text-muted-foreground hover:bg-glass-border/50 hover:text-foreground transition-colors"
                              title="Device connected"
                              disabled
                           >
                              <LinkIcon className="w-4 h-4" />
                           </button>
                        ) : (
                           <button 
                              onClick={() => connectDeviceMut.mutate({ macAddress: dev.macAddress })}
                              disabled={connectDeviceMut.isPending}
                              className="w-10 h-10 rounded-full border border-primary/30 flex items-center justify-center text-primary/70 hover:bg-primary/10 hover:text-primary transition-colors"
                              title="Connect"
                           >
                              <Unlink className="w-4 h-4" />
                           </button>
                        )}
                        <button 
                           onClick={() => {
                             if(confirm("Remove this device?")) {
                               removeDeviceMut.mutate({ id: dev.id });
                             }
                           }}
                           className="w-10 h-10 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center justify-center transition-colors"
                           disabled={removeDeviceMut.isPending}
                        >
                           <Trash2 className="w-4 h-4" />
                        </button>
                     </div>
                   </div>
                 ))
               )}
            </div>
         </GlassCard>

         <GlassCard className="p-8">
            <h2 className="text-2xl font-bold flex items-center gap-3 mb-6">
              {isDark ? <Moon className="w-5 h-5 text-secondary" /> : <Sun className="w-5 h-5 text-yellow-400" />}
              Appearance
            </h2>
            <div className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-glass-border">
               <div className="flex flex-col gap-0.5">
                 <span className="font-semibold">App Theme</span>
                 <span className="text-xs text-muted-foreground">Choose between dark and light mode across the entire app.</span>
               </div>
               <div className="flex items-center gap-1 p-1 rounded-full bg-glass-bg border border-glass-border">
                 <button
                   onClick={() => setTheme("light")}
                   className={`px-3 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5 text-sm font-medium ${
                     !isDark ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                   }`}
                 >
                   <Sun className="w-3.5 h-3.5" /> Light
                 </button>
                 <button
                   onClick={() => setTheme("dark")}
                   className={`px-3 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5 text-sm font-medium ${
                     isDark ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                   }`}
                 >
                   <Moon className="w-3.5 h-3.5" /> Dark
                 </button>
               </div>
            </div>
         </GlassCard>

         <GlassCard className="p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <Shield className="w-5 h-5 text-tertiary" />
                Private Vault
              </h2>
              {(trashedRecordings?.length ?? 0) > 0 && (
                <Button
                  variant="outline"
                  className="rounded-full shadow-glass-sm text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => {
                    if (confirm(`Permanently delete all ${trashedRecordings!.length} trashed recording(s)? This cannot be undone.`)) {
                      emptyTrashMut.mutate({});
                    }
                  }}
                  disabled={emptyTrashMut.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Empty Trash
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-glass-border mb-4">
               <div className="flex flex-col">
                  <span className="font-semibold">Offline Mode Active</span>
                  <span className="text-xs text-muted-foreground">AluNotes Vault relies on local storage for metadata when offline.</span>
               </div>
               <div className="w-10 h-10 rounded-full bg-tertiary/10 text-tertiary flex items-center justify-center">
                 <KeyRound className="w-5 h-5" />
               </div>
            </div>

            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Trash ({trashedRecordings?.length ?? 0})
            </h3>

            {!trashedRecordings?.length ? (
              <div className="text-muted-foreground text-sm p-4 text-center">Trash is empty.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {trashedRecordings.map((rec) => (
                  <div key={rec.sessionId} className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-glass-border group">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-glass-bg border border-glass-border flex items-center justify-center text-muted-foreground">
                        <Music className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">{rec.label || rec.sessionId}</span>
                        <span className="text-xs text-muted-foreground">
                          {rec.date} {rec.time}
                          {rec.duration ? ` \u2022 ${Math.floor(rec.duration / 60)}:${Math.floor(rec.duration % 60).toString().padStart(2, "0")}` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => restoreMut.mutate({ sessionId: rec.sessionId })}
                        disabled={restoreMut.isPending}
                        className="w-9 h-9 rounded-full flex items-center justify-center text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Restore"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Permanently delete this recording? This cannot be undone.")) {
                            deletePermanentMut.mutate({ sessionId: rec.sessionId });
                          }
                        }}
                        disabled={deletePermanentMut.isPending}
                        className="w-9 h-9 rounded-full flex items-center justify-center text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete permanently"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
         </GlassCard>
       </div>
    </div>
  );
}
