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
    .input(z.object({ title: z.string().optional() }))
    .handler(async ({ input, context }) => {
      return context.db.note.create({
        data: {
          title: input.title ?? "Untitled",
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
      })
    )
    .handler(async ({ input, context }) => {
      return context.db.note.update({
        where: { id: input.id, userId: context.session.user.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.content !== undefined && { content: input.content }),
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
};
