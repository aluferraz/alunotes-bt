"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import { Headphones, Smartphone, Loader2, Bluetooth, Plus, Check, Zap } from "lucide-react";
import { useEffect, useState } from "react";

export function OnboardingFlow() {
  const queryClient = useQueryClient();
  const [isScanning, setIsScanning] = useState(false);
  const [connectingMac, setConnectingMac] = useState<string | null>(null);

  const { data: status } = useQuery(orpc.bluetooth.status.queryOptions({
    refetchInterval: 3000,
  }));

  const { mutate: setDiscoverable } = useMutation(
    orpc.bluetooth.setDiscoverable.mutationOptions(),
  );

  // Once the headphone is paired and we're waiting on a phone/PC to connect
  // as the source, open the sink adapter for pairing. BlueZ's default 180s
  // DiscoverableTimeout is cleared server-side so this stays on until we
  // turn it off (or the bridge tears down).
  const shouldBeDiscoverable = Boolean(
    status?.connectedHeadphone?.connected &&
      !status?.connectedSource?.connected,
  );
  const isDiscoverable = status?.discoverable ?? false;
  useEffect(() => {
    if (!status) return;
    if (shouldBeDiscoverable && !isDiscoverable) {
      setDiscoverable({ enabled: true });
    } else if (!shouldBeDiscoverable && isDiscoverable) {
      setDiscoverable({ enabled: false });
    }
  }, [status, shouldBeDiscoverable, isDiscoverable, setDiscoverable]);
  
  const isHeadphoneConnected = status?.connectedHeadphone?.connected;
  const scanActive = isScanning && !isHeadphoneConnected;
  const { data: scanResults, refetch: scan } = useQuery(orpc.bluetooth.scan.queryOptions({
    enabled: scanActive,
    refetchInterval: scanActive ? 1000 : false,
    staleTime: 0,
  }));
  
  const { data: savedDevices } = useQuery(orpc.bluetooth.devices.queryOptions());

  const { mutate: connectDevice, isPending } = useMutation(
    orpc.bluetooth.connect.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [["bluetooth", "status"]] });
        setConnectingMac(null);
      },
      onError: () => {
        setConnectingMac(null);
      }
    })
  );

  const handleScan = async () => {
    setIsScanning(true);
    await scan();
  };

  const handleConnect = (mac: string) => {
    setConnectingMac(mac);
    connectDevice({ macAddress: mac });
  };

  const isSourceConnected = status?.connectedSource?.connected;

  const scanArray = scanResults || [];
  const named = scanArray.filter((d) => d.name).sort((a, b) => b.rssi - a.rssi);
  const unnamed = scanArray.filter((d) => !d.name).sort((a, b) => b.rssi - a.rssi);

  const renderDeviceCard = (device: typeof scanArray[0]) => (
    <GlassCard 
      key={device.mac} 
      className="p-4 flex items-center justify-between hover:bg-glass-border/40 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-glass-bg flex items-center justify-center">
          <Headphones className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col text-left">
           <span className="font-semibold">{device.name || "Unknown Device"}</span>
           <span className="text-xs text-muted-foreground uppercase">{device.mac}</span>
        </div>
      </div>
      <button 
        onClick={() => handleConnect(device.mac)}
        disabled={isPending && connectingMac !== device.mac}
        className="w-10 h-10 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center hover:bg-secondary-dim transition-colors disabled:opacity-50"
      >
        {connectingMac === device.mac ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
      </button>
    </GlassCard>
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] max-w-2xl mx-auto text-center px-4">
      
      {!isHeadphoneConnected ? (
        <div className="flex flex-col items-center w-full animate-in fade-in slide-in-from-bottom-8 duration-700">
           <div className="w-24 h-24 rounded-full bg-secondary/10 flex items-center justify-center mb-8 relative border border-secondary/20 shadow-[0_0_40px_rgba(166,140,255,0.2)]">
             <div className="absolute inset-0 rounded-full border border-secondary/30 animate-ping" />
             <Headphones className="w-10 h-10 text-secondary relative z-10" />
           </div>
           <h1 className="text-4xl font-extrabold text-foreground mb-4">Connect your headphones</h1>
           <p className="text-lg text-muted-foreground mb-12">
             Ensure your Bluetooth headphones are in pairing mode to begin the Audio Bridge sync.
           </p>

           <div className="w-full text-left">
             {(() => {
               const lastHeadphone = savedDevices?.find((d) => d.type === "headphone");
               if (!lastHeadphone) return null;
               return (
                 <div className="mb-8">
                   <span className="font-semibold text-lg flex items-center gap-2 mb-4">
                     <Zap className="w-5 h-5 text-yellow-400" />
                     Quick Connect
                   </span>
                   <GlassCard className="p-4 flex items-center justify-between hover:bg-glass-border/40 transition-colors border-secondary/30">
                     <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                         <Headphones className="w-4 h-4 text-secondary" />
                       </div>
                       <div className="flex flex-col text-left">
                         <span className="font-semibold">{lastHeadphone.name}</span>
                         <span className="text-xs text-muted-foreground uppercase">{lastHeadphone.macAddress}</span>
                       </div>
                     </div>
                     <button
                       onClick={() => handleConnect(lastHeadphone.macAddress)}
                       disabled={isPending}
                       className="px-4 py-2 rounded-full bg-secondary text-secondary-foreground text-sm font-medium flex items-center gap-2 hover:bg-secondary-dim transition-colors disabled:opacity-50"
                     >
                       {connectingMac === lastHeadphone.macAddress ? (
                         <Loader2 className="w-4 h-4 animate-spin" />
                       ) : (
                         "Connect"
                       )}
                     </button>
                   </GlassCard>
                 </div>
               );
             })()}
           </div>

           <div className="w-full text-left">
             <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-lg flex items-center gap-2">
                  <Bluetooth className="w-5 h-5 text-secondary" />
                  Nearby Devices
                </span>
                <button 
                  onClick={handleScan}
                  disabled={isScanning || isPending}
                  className="px-4 py-2 rounded-full bg-secondary/10 hover:bg-secondary/20 text-secondary text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {isScanning ? (
                     <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Scanning</span>
                  ) : "Scan"}
                </button>
             </div>

             <div className="flex flex-col gap-3">
               {!scanResults?.length && !isScanning && (
                 <GlassCard className="p-6 flex items-center justify-center text-muted-foreground border-dashed">
                    Click scan to find your headphones
                 </GlassCard>
               )}

               {named.length > 0 && (
                 <div className="space-y-3">
                   {named.map(renderDeviceCard)}
                 </div>
               )}
               {unnamed.length > 0 && (
                 <div className="space-y-3 mt-4">
                   <p className="px-1 text-xs font-medium text-muted-foreground">
                     Other devices ({unnamed.length})
                   </p>
                   <div className="max-h-64 space-y-3 overflow-y-auto pr-2">
                     {unnamed.map(renderDeviceCard)}
                   </div>
                 </div>
               )}
             </div>
           </div>
        </div>
      ) : (
        <div className="flex flex-col items-center w-full animate-in fade-in slide-in-from-bottom-8 duration-700">
           <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-8 relative border border-primary/20 shadow-[0_0_40px_rgba(129,236,255,0.2)]">
             <div className="absolute inset-0 rounded-full border border-primary/30 animate-pulse" />
             <Smartphone className="w-10 h-10 text-primary relative z-10" />
           </div>
           <h1 className="text-4xl font-extrabold text-foreground mb-4">Connect your Audio Source</h1>
           <p className="text-lg text-muted-foreground mb-12">
             Phone, PC, or Tablet. AluNotes uses an encrypted private bridge to ensure your audio transcripts remain secure and local.
           </p>

           <div className="w-full text-left">
             <GlassCard className="p-6 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-3xl" />
               <div className="flex flex-col gap-4 relative z-10">
                 <div className="flex items-center gap-3 text-lg font-semibold">
                   <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                     <Check className="w-4 h-4 text-green-500" />
                   </div>
                   Headphones Connected
                 </div>
                 <div className="pl-11 text-muted-foreground">
                   {status?.connectedHeadphone?.name || "Ready to bridge"}
                 </div>
                 
                 <div className="h-[1px] w-full bg-border my-2" />

                 <div className="flex items-start gap-4">
                   <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                     <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                   </div>
                   <div className="flex flex-col gap-1">
                     <span className="font-semibold text-lg">Waiting for Source...</span>
                     <span className="text-muted-foreground">Pair your phone or PC with the Audio Bridge bluetooth device to continue.</span>
                   </div>
                 </div>
               </div>
             </GlassCard>
           </div>
        </div>
      )}

    </div>
  );
}
