import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";
import { env } from "~/env";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import * as os from "node:os";

const bridgeConfigSchema = z.object({
  bluetooth: z
    .object({
      sink_adapter: z.string().default("hci0"),
      source_adapter: z.string().default("hci1"),
      sink_name: z.string().default(""),
      target_headphone: z.string().default(""),
      auto_connect: z.boolean().default(true),
      device_id_file: z.string().default(""),
    })
    .default({}),
  audio: z
    .object({
      sample_rate: z.number().default(44100),
      channels: z.number().default(2),
      bit_depth: z.number().default(16),
      buffer_size: z.number().default(1024),
      channel_buffer: z.number().default(64),
    })
    .default({}),
  session: z
    .object({
      idle_timeout: z.string().default("30s"),
      silence_threshold: z.number().default(100),
    })
    .default({}),
  storage: z
    .object({
      base_dir: z.string().default("./recordings"),
      format: z.string().default("wav"),
    })
    .default({}),
});

type BridgeConfig = z.infer<typeof bridgeConfigSchema>;

function getConfigPath(): string {
  return path.resolve(env.BRIDGE_CONFIG_PATH);
}

function readConfig(): BridgeConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return bridgeConfigSchema.parse({});
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown>;
  return bridgeConfigSchema.parse(parsed ?? {});
}

function writeConfig(config: BridgeConfig): void {
  const configPath = getConfigPath();
  const yamlStr = yaml.dump(config, { lineWidth: -1 });

  // Atomic write: write to temp file, then rename
  const tmpPath = path.join(
    os.tmpdir(),
    `alunotes-config-${Date.now()}.yaml`,
  );
  fs.writeFileSync(tmpPath, yamlStr, "utf-8");
  fs.renameSync(tmpPath, configPath);
}

export const settingsRouter = {
  // Read current bridge configuration from YAML
  get: protectedProcedure.handler(async () => {
    return readConfig();
  }),

  // Update bridge configuration (writes to YAML file)
  update: protectedProcedure
    .input(
      z.object({
        bluetooth: z
          .object({
            sink_adapter: z.string().optional(),
            source_adapter: z.string().optional(),
            sink_name: z.string().optional(),
            target_headphone: z.string().optional(),
            auto_connect: z.boolean().optional(),
          })
          .optional(),
        audio: z
          .object({
            sample_rate: z.number().optional(),
            channels: z.number().optional(),
            bit_depth: z.number().optional(),
            buffer_size: z.number().optional(),
            channel_buffer: z.number().optional(),
          })
          .optional(),
        session: z
          .object({
            idle_timeout: z.string().optional(),
            silence_threshold: z.number().optional(),
          })
          .optional(),
        storage: z
          .object({
            base_dir: z.string().optional(),
            format: z.string().optional(),
          })
          .optional(),
      }),
    )
    .handler(async ({ input }) => {
      const current = readConfig();

      // Deep merge input onto current
      const merged: BridgeConfig = {
        bluetooth: { ...current.bluetooth, ...input.bluetooth },
        audio: { ...current.audio, ...input.audio },
        session: { ...current.session, ...input.session },
        storage: { ...current.storage, ...input.storage },
      };

      writeConfig(merged);
      return merged;
    }),
};
