import { z } from "zod";
import { protectedProcedure } from "~/server/api/orpc";

export const profileRouter = {
  get: protectedProcedure.handler(async ({ context }) => {
    const user = await context.db.user.findUnique({
      where: { id: context.session.user.id },
      include: { accounts: { select: { providerId: true } } },
    });
    if (!user) throw new Error("User not found");

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      providers: user.accounts.map((a) => a.providerId),
      createdAt: user.createdAt.toISOString(),
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        image: z.string().url().nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const user = await context.db.user.update({
        where: { id: context.session.user.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.image !== undefined && { image: input.image }),
        },
      });

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      };
    }),
};
