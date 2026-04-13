import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { protectedProcedure } from "~/server/api/orpc";
import { env } from "~/env";

export const notesRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    return context.db.note.findMany({
      where: { userId: context.session.user.id },
      orderBy: { updatedAt: "desc" },
    });
  }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const note = await context.db.note.findUnique({
        where: { id: input.id, userId: context.session.user.id },
      });
      if (!note) throw new Error("Not found");
      return note;
    }),
  create: protectedProcedure
    .input(z.object({ title: z.string().optional(), folderId: z.string().nullable().optional() }))
    .handler(async ({ input, context }) => {
      return context.db.note.create({
        data: {
          title: input.title ?? "Untitled",
          folderId: input.folderId ?? undefined,
          userId: context.session.user.id,
        },
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        folderId: z.string().nullable().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      return context.db.note.update({
        where: { id: input.id, userId: context.session.user.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.content !== undefined && { content: input.content }),
          ...(input.folderId !== undefined && { folderId: input.folderId }),
        },
      });
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      await context.db.note.delete({
        where: { id: input.id, userId: context.session.user.id },
      });
      return { success: true };
    }),

  getOrCreateForRecording: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;

      const existing = await context.db.note.findUnique({
        where: { recordingSessionId: input.sessionId },
      });
      if (existing) {
        const meta = await context.db.recordingMeta.findUnique({
          where: { sessionId: input.sessionId },
        });
        if (meta?.label && meta.label !== existing.title) {
          await context.db.note.update({
            where: { id: existing.id },
            data: { title: meta.label },
          });
          return { ...existing, title: meta.label };
        }
        return existing;
      }

      const meta = await context.db.recordingMeta.findUnique({
        where: { sessionId: input.sessionId },
      });
      const title = meta?.label || `Recording ${input.sessionId.replace("/", " ")}`;

      return context.db.note.create({
        data: {
          title,
          recordingSessionId: input.sessionId,
          userId,
        },
      });
    }),

  /** Mark a note as having had its alunote generated. */
  setAlunoteGenerated: protectedProcedure
    .input(z.object({ id: z.string(), generated: z.boolean() }))
    .handler(async ({ input, context }) => {
      return context.db.note.update({
        where: { id: input.id, userId: context.session.user.id },
        data: { alunoteGenerated: input.generated },
      });
    }),
};

/** Resolve the WAV file path for a recording session. Used by the diarize API route. */
export function resolveWavPath(sessionId: string): string | null {
  const [date, time] = sessionId.split("/");
  if (!date || !time) return null;
  const baseDir = path.resolve(env.RECORDINGS_DIR);
  const sessionDir = path.join(baseDir, date, time);
  if (!fs.existsSync(sessionDir)) return null;
  const files = fs.readdirSync(sessionDir);
  const wav = files.find((f) => f.startsWith("recording-") && f.endsWith(".wav"));
  if (wav) return path.join(sessionDir, wav);
  if (files.includes("recording.wav")) return path.join(sessionDir, "recording.wav");
  return null;
}
