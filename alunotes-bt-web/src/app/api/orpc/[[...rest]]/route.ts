/* eslint-disable @typescript-eslint/unbound-method */
import { RPCHandler } from "@orpc/server/fetch";
import { type NextRequest } from "next/server";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createORPCContext } from "~/server/api/orpc";

const handler = new RPCHandler(appRouter, {
  interceptors: [
    async ({ next }) => {
      try {
        return await next();
      } catch (error) {
        if (env.NODE_ENV === "development") {
          console.error(error);
        }
        throw error;
      }
    },
  ],
});

async function handleRequest(request: NextRequest) {
  const { response } = await handler.handle(request, {
    prefix: "/api/orpc",
    context: await createORPCContext({ headers: request.headers }),
  });

  return response ?? new Response("Not found", { status: 404 });
}

export { handleRequest as GET, handleRequest as POST };
