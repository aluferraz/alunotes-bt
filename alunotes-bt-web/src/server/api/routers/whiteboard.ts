import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";

export const whiteboardRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    return context.db.whiteboard.findMany({
      where: { userId: context.session.user.id },
      orderBy: { updatedAt: "desc" },
    });
  }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const board = await context.db.whiteboard.findUnique({
        where: { id: input.id, userId: context.session.user.id },
      });
      if (!board) throw new Error("Not found");
      return board;
    }),
  create: protectedProcedure
    .input(z.object({ name: z.string().optional() }))
    .handler(async ({ input, context }) => {
      return context.db.whiteboard.create({
        data: {
          name: input.name ?? "Untitled Canvas",
          userId: context.session.user.id,
        },
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        elements: z.string().optional(),
        appState: z.string().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      return context.db.whiteboard.update({
        where: { id: input.id, userId: context.session.user.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.elements !== undefined && { elements: input.elements }),
          ...(input.appState !== undefined && { appState: input.appState }),
        },
      });
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      await context.db.whiteboard.delete({
        where: { id: input.id, userId: context.session.user.id },
      });
      return { success: true };
    }),
};
