import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";

export const tasksRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    return context.db.task.findMany({
      where: { userId: context.session.user.id },
      orderBy: { order: "asc" },
    });
  }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      return context.db.task.findUniqueOrThrow({
        where: { id: input.id, userId: context.session.user.id },
      });
    }),
  create: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        priority: z.string().optional(),
        status: z.string().optional(),
        dueDate: z.string().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      const maxOrder = await context.db.task.aggregate({
        where: { userId: context.session.user.id },
        _max: { order: true },
      });
      return context.db.task.create({
        data: {
          title: input.title,
          description: input.description,
          priority: input.priority ?? "MEDIUM",
          status: input.status ?? "TODO",
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          order: (maxOrder._max.order ?? -1) + 1,
          userId: context.session.user.id,
        },
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        order: z.number().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      return context.db.task.update({
        where: { id: input.id, userId: context.session.user.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.dueDate !== undefined && {
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
          }),
          ...(input.order !== undefined && { order: input.order }),
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
