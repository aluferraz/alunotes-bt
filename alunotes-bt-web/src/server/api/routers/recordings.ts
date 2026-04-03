import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";
import { env } from "~/env";
import * as fs from "node:fs";
import * as path from "node:path";

function getRecordingsDir(): string {
  return path.resolve(env.RECORDINGS_DIR);
}

// Parse WAV header to get duration
function getWavDuration(filePath: string): number | null {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);

    // WAV header: bytes 28-31 = byte rate, bytes 4-7 = chunk size
    const byteRate = header.readUInt32LE(28);
    const fileSize = fs.statSync(filePath).size;
    if (byteRate === 0) return null;
    // Data starts at byte 44, duration = data size / byte rate
    return (fileSize - 44) / byteRate;
  } catch {
    return null;
  }
}

// Scan the recordings directory and return session info
function scanRecordingsDir(
  dateFilter?: string,
): Array<{
  sessionId: string;
  filePath: string;
  fileSize: number;
  duration: number | null;
  date: string;
  time: string;
}> {
  const baseDir = getRecordingsDir();
  if (!fs.existsSync(baseDir)) return [];

  const results: Array<{
    sessionId: string;
    filePath: string;
    fileSize: number;
    duration: number | null;
    date: string;
    time: string;
  }> = [];

  const dateDirs = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    if (dateFilter && dateDir !== dateFilter) continue;

    const datePath = path.join(baseDir, dateDir);
    const timeDirs = fs
      .readdirSync(datePath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{2}-\d{2}-\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse();

    for (const timeDir of timeDirs) {
      const sessionDir = path.join(datePath, timeDir);
      const wavPath = path.join(sessionDir, "recording.wav");

      if (fs.existsSync(wavPath)) {
        const stats = fs.statSync(wavPath);
        const sessionId = `${dateDir}/${timeDir}`;
        results.push({
          sessionId,
          filePath: wavPath,
          fileSize: stats.size,
          duration: getWavDuration(wavPath),
          date: dateDir,
          time: timeDir,
        });
      }
    }
  }

  return results;
}

export const recordingsRouter = {
  // List recordings with optional date filter and pagination
  list: protectedProcedure
    .input(
      z
        .object({
          date: z.string().optional(),
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const { date, page = 1, limit = 20 } = input ?? {};
      const allSessions = scanRecordingsDir(date);

      const total = allSessions.length;
      const offset = (page - 1) * limit;
      const paginated = allSessions.slice(offset, offset + limit);

      // Enrich with Prisma metadata
      const sessionIds = paginated.map((s) => s.sessionId);
      const metas = await context.db.recordingMeta.findMany({
        where: { sessionId: { in: sessionIds } },
      });
      const metaMap = new Map(metas.map((m) => [m.sessionId, m]));

      const items = paginated.map((s) => {
        const meta = metaMap.get(s.sessionId);
        return {
          sessionId: s.sessionId,
          date: s.date,
          time: s.time,
          fileSize: s.fileSize,
          duration: meta?.duration ?? s.duration,
          favorite: meta?.favorite ?? false,
          label: meta?.label ?? null,
        };
      });

      return { items, total, page, limit };
    }),

  // Get details for a single recording session
  get: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .handler(async ({ input, context }) => {
      const [date, time] = input.sessionId.split("/");
      if (!date || !time) throw new Error("Invalid sessionId format");

      const baseDir = getRecordingsDir();
      const wavPath = path.join(baseDir, date, time, "recording.wav");

      if (!fs.existsSync(wavPath)) {
        throw new Error("Recording not found");
      }

      const stats = fs.statSync(wavPath);
      const duration = getWavDuration(wavPath);
      const meta = await context.db.recordingMeta.findUnique({
        where: { sessionId: input.sessionId },
      });

      return {
        sessionId: input.sessionId,
        date: date,
        time: time,
        fileSize: stats.size,
        duration: meta?.duration ?? duration,
        favorite: meta?.favorite ?? false,
        label: meta?.label ?? null,
        sampleRate: meta?.sampleRate ?? 44100,
        channels: meta?.channels ?? 2,
        bitDepth: meta?.bitDepth ?? 16,
      };
    }),

  // Toggle favorite on a recording
  favorite: protectedProcedure
    .input(z.object({ sessionId: z.string(), favorite: z.boolean() }))
    .handler(async ({ input, context }) => {
      return context.db.recordingMeta.upsert({
        where: { sessionId: input.sessionId },
        create: {
          sessionId: input.sessionId,
          filePath: path.join(
            getRecordingsDir(),
            ...input.sessionId.split("/"),
            "recording.wav",
          ),
          favorite: input.favorite,
        },
        update: { favorite: input.favorite },
      });
    }),

  // Set a label on a recording
  label: protectedProcedure
    .input(z.object({ sessionId: z.string(), label: z.string().nullable() }))
    .handler(async ({ input, context }) => {
      return context.db.recordingMeta.upsert({
        where: { sessionId: input.sessionId },
        create: {
          sessionId: input.sessionId,
          filePath: path.join(
            getRecordingsDir(),
            ...input.sessionId.split("/"),
            "recording.wav",
          ),
          label: input.label,
        },
        update: { label: input.label },
      });
    }),

  // Scan filesystem and sync metadata to database
  scan: protectedProcedure.handler(async ({ context }) => {
    const sessions = scanRecordingsDir();
    let newCount = 0;

    for (const s of sessions) {
      const existing = await context.db.recordingMeta.findUnique({
        where: { sessionId: s.sessionId },
      });
      if (!existing) {
        await context.db.recordingMeta.create({
          data: {
            sessionId: s.sessionId,
            filePath: s.filePath,
            fileSize: s.fileSize,
            duration: s.duration,
          },
        });
        newCount++;
      } else if (!existing.fileSize || !existing.duration) {
        await context.db.recordingMeta.update({
          where: { sessionId: s.sessionId },
          data: {
            fileSize: s.fileSize ?? existing.fileSize,
            duration: s.duration ?? existing.duration,
          },
        });
      }
    }

    return { scanned: sessions.length, new: newCount };
  }),

  // Delete a recording session
  delete: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .handler(async ({ input, context }) => {
      const [date, time] = input.sessionId.split("/");
      if (!date || !time) throw new Error("Invalid sessionId format");

      const baseDir = getRecordingsDir();
      const sessionDir = path.join(baseDir, date, time);

      // Delete from filesystem
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true });
      }

      // Delete from database
      await context.db.recordingMeta
        .delete({ where: { sessionId: input.sessionId } })
        .catch(() => {
          /* may not exist in DB */
        });

      // Clean up empty date directory
      const dateDir = path.join(baseDir, date);
      if (fs.existsSync(dateDir)) {
        const remaining = fs.readdirSync(dateDir);
        if (remaining.length === 0) {
          fs.rmdirSync(dateDir);
        }
      }
    }),
};
