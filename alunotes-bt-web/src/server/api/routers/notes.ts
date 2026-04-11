import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";

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

      // Check if a note already exists for this recording
      const existing = await context.db.note.findUnique({
        where: { recordingSessionId: input.sessionId },
      });
      if (existing) {
        // Sync title with recording label
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

      // Derive title from recording label or sessionId
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
};
