import { z } from "zod";
import { publicProcedure } from "~/server/api/orpc";
import { env } from "~/env";

// Types matching the Go daemon's internal state
interface DeviceStatus {
  name: string;
  mac: string;
  connected: boolean;
}

interface BridgeStatus {
  bridgeRunning: boolean;
  discoverable: boolean;
  sinkAdapter: string;
  sourceAdapter: string;
  dualMode: boolean;
  sinkName: string;
  connectedSource: DeviceStatus | null;
  connectedHeadphone: DeviceStatus | null;
  activeSession: {
    id: string;
    startedAt: string;
    duration: number;
  } | null;
  pipelineActive: boolean;
  autoRecord: boolean;
}

async function bridgeApiCall<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${env.BRIDGE_API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Bridge API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function bridgeApiCallSafe<T>(
  path: string,
  options?: RequestInit,
): Promise<{ data: T | null; reachable: boolean }> {
  try {
    const data = await bridgeApiCall<T>(path, options);
    return { data, reachable: true };
  } catch {
    return { data: null, reachable: false };
  }
}

export const bluetoothRouter = {
  // Get bridge status from Go daemon API
  status: publicProcedure.handler(async () => {
    const result = await bridgeApiCallSafe<BridgeStatus>(
      "/api/v1/status",
    );

    if (!result.reachable) {
      return {
        bridgeRunning: false,
        discoverable: false,
        sinkAdapter: "",
        sourceAdapter: "",
        dualMode: false,
        sinkName: "",
        connectedSource: null,
        connectedHeadphone: null,
        activeSession: null,
        pipelineActive: false,
        autoRecord: true,
      };
    }

    return result.data!;
  }),

  // List saved devices from Prisma
  devices: publicProcedure.handler(async ({ context }) => {
    const devices = await context.db.device.findMany({
      orderBy: { lastSeen: "desc" },
    });

    // Try to get live connection status from Go daemon
    const liveStatus = await bridgeApiCallSafe<
      Array<{ mac: string; connected: boolean }>
    >("/api/v1/bluetooth/devices");

    if (liveStatus.reachable && liveStatus.data) {
      const liveMap = new Map(
        liveStatus.data.map((d) => [d.mac, d.connected]),
      );
      return devices.map((d) => ({
        ...d,
        connected: liveMap.get(d.macAddress) ?? false,
      }));
    }

    return devices.map((d) => ({ ...d, connected: false }));
  }),

  // Scan for nearby Bluetooth devices via Go daemon
  scan: publicProcedure.handler(async () => {
    const result = await bridgeApiCallSafe<
      Array<{
        name: string;
        mac: string;
        rssi: number;
        connected: boolean;
        paired: boolean;
      }>
    >("/api/v1/bluetooth/scan");

    if (!result.reachable || !result.data) {
      return [];
    }

    return result.data;
  }),

  // Trigger headphone connection via Go daemon
  connect: publicProcedure
    .input(z.object({ macAddress: z.string() }))
    .handler(async ({ input, context }) => {
      const result = await bridgeApiCall<{ success: boolean; message: string }>(
        "/api/v1/bluetooth/connect",
        {
          method: "POST",
          body: JSON.stringify({ mac_address: input.macAddress }),
        },
      );

      // Update lastSeen so Quick Connect shows the most recently used device
      if (result.success) {
        await context.db.device.updateMany({
          where: { macAddress: input.macAddress },
          data: { lastSeen: new Date() },
        });
      }

      return result;
    }),

  // Toggle the sink adapter's Bluetooth discoverability. Used by the /audio
  // route to open the sink for phone pairing only once a headphone is ready.
  setDiscoverable: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .handler(async ({ input }) => {
      const result = await bridgeApiCallSafe<{
        success: boolean;
        discoverable?: boolean;
        message?: string;
      }>("/api/v1/bluetooth/discoverable", {
        method: "POST",
        body: JSON.stringify({ enabled: input.enabled }),
      });
      return {
        success: result.reachable && (result.data?.success ?? false),
        discoverable: result.data?.discoverable ?? input.enabled,
      };
    }),

  // Trigger headphone disconnection via Go daemon
  disconnect: publicProcedure
    .input(z.object({ macAddress: z.string() }))
    .handler(async ({ input }) => {
      const result = await bridgeApiCall<{ success: boolean; message: string }>(
        "/api/v1/bluetooth/disconnect",
        {
          method: "POST",
          body: JSON.stringify({ mac_address: input.macAddress }),
        },
      );
      return result;
    }),

  // Save a device to the local DB
  saveDevice: publicProcedure
    .input(
      z.object({
        macAddress: z.string(),
        name: z.string(),
        type: z.enum(["headphone", "source"]),
        trusted: z.boolean().optional(),
        notes: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const device = await context.db.device.upsert({
        where: { macAddress: input.macAddress },
        create: {
          macAddress: input.macAddress,
          name: input.name,
          type: input.type,
          trusted: input.trusted ?? false,
          notes: input.notes,
        },
        update: {
          name: input.name,
          type: input.type,
          trusted: input.trusted,
          notes: input.notes,
          lastSeen: new Date(),
        },
      });

      // Auto-connect after saving
      await bridgeApiCallSafe("/api/v1/bluetooth/connect", {
        method: "POST",
        body: JSON.stringify({ mac_address: input.macAddress }),
      });

      return device;
    }),

  // Unpair and remove a device
  removeDevice: publicProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      // Look up MAC before deleting so we can unpair via BlueZ
      const device = await context.db.device.findUnique({
        where: { id: input.id },
      });

      if (device) {
        // Unpair from BlueZ (disconnect + remove pairing)
        await bridgeApiCallSafe("/api/v1/bluetooth/remove", {
          method: "POST",
          body: JSON.stringify({ mac_address: device.macAddress }),
        });
      }

      await context.db.device.delete({ where: { id: input.id } });
    }),

  // Stop the active recording session on the Go daemon
  stopRecording: publicProcedure.handler(async () => {
    const result = await bridgeApiCallSafe<{ success: boolean; message: string }>(
      "/api/v1/recording/stop",
      { method: "POST" },
    );
    return {
      success: result.reachable && (result.data?.success ?? false),
      message: result.reachable
        ? (result.data?.message ?? "stopped")
        : "Bridge unreachable",
    };
  }),

  // Set auto-record on/off on the Go daemon
  setAutoRecord: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .handler(async ({ input }) => {
      const result = await bridgeApiCallSafe<{ success: boolean; enabled: boolean }>(
        "/api/v1/recording/auto-record",
        {
          method: "POST",
          body: JSON.stringify({ enabled: input.enabled }),
        },
      );
      return {
        success: result.reachable && (result.data?.success ?? false),
        enabled: result.data?.enabled ?? input.enabled,
      };
    }),
};
