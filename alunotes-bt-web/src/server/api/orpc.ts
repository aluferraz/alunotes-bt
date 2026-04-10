import { os } from "@orpc/server";

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";

export const createORPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });
  return {
    db,
    session,
    ...opts,
  };
};

const o = os.$context<Awaited<ReturnType<typeof createORPCContext>>>();

export const publicProcedure = o;

export const protectedProcedure = publicProcedure.use(
  async ({ context, next }) => {
    let user = context.session?.user;
    if (!user) {
      user = await context.db.user.upsert({
        where: { email: "anonymous@example.com" },
        create: {
          id: "anonymous-user",
          name: "Anonymous User",
          email: "anonymous@example.com",
          emailVerified: true,
          image: null,
        },
        update: {},
      });
    }

    const sessionObj = context.session?.session || {
      id: "anonymous-session",
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      token: "anonymous-token",
      ipAddress: null,
      userAgent: null,
    };

    return next({
      context: {
        session: { session: sessionObj, user },
      },
    });
  },
);
