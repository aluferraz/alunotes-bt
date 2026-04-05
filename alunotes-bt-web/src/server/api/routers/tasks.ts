import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";

export const tasksRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    return context.db.task.findMany({
      where: { userId: context.session.user.id },
      orderBy: { order: "asc" },
    });
  }),
  create: protectedProcedure
    .input(z.object({ title: z.string(), priority: z.string().optional() }))
    .handler(async ({ input, context }) => {
      return context.db.task.create({
        data: {
          title: input.title,
          priority: input.priority ?? "MEDIUM",
          userId: context.session.user.id,
        },
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      return context.db.task.update({
        where: { id: input.id, userId: context.session.user.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.priority !== undefined && { priority: input.priority }),
        },
      });
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      await context.db.task.delete({
        where: { id: input.id, userId: context.session.user.id },
      });
      return { success: true };
    }),
};
