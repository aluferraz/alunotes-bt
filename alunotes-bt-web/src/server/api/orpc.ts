import { ORPCError, os } from "@orpc/server";

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

const timingMiddleware = o.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (process.env.NODE_ENV === "development") {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  try {
    return await next();
  } finally {
    const end = Date.now();
    console.log(`[oRPC] ${String(path)} took ${end - start}ms to execute`);
  }
});

export const publicProcedure = o.use(timingMiddleware);

export const protectedProcedure = publicProcedure.use(
  ({ context, next }) => {
    if (!context.session?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({
      context: {
        session: { ...context.session, user: context.session.user },
      },
    });
  },
);
