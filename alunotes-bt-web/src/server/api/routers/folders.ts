import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";

export const foldersRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    return context.db.folder.findMany({
      where: { userId: context.session.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { notes: true, tasks: true, whiteboards: true } },
      },
    });
  }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const folder = await context.db.folder.findUnique({
        where: { id: input.id, userId: context.session.user.id },
        include: {
          notes: { orderBy: { updatedAt: "desc" } },
          tasks: { orderBy: { order: "asc" } },
          whiteboards: { orderBy: { updatedAt: "desc" } },
        },
      });
      if (!folder) throw new Error("Not found");
      return folder;
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      return context.db.folder.create({
        data: {
          name: input.name,
          color: input.color,
          icon: input.icon,
          userId: context.session.user.id,
        },
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        color: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      return context.db.folder.update({
        where: { id: input.id, userId: context.session.user.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.color !== undefined && { color: input.color }),
          ...(input.icon !== undefined && { icon: input.icon }),
        },
      });
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      await context.db.folder.delete({
        where: { id: input.id, userId: context.session.user.id },
      });
      return { success: true };
    }),
};
