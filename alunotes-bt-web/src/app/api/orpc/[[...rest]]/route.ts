/* eslint-disable @typescript-eslint/unbound-method */
import {
  CONTEXT_LOGGER_SYMBOL,
  LoggingHandlerPlugin,
} from "@orpc/experimental-pino";
import { RPCHandler } from "@orpc/server/fetch";
import pino from "pino";
import { type NextRequest } from "next/server";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { logger } from "~/server/logger";
import { createORPCContext } from "~/server/api/orpc";

const isDev = env.NODE_ENV === "development";

const silentLogger = pino({ level: "silent" });

const IGNORED_PATHS = ["/api/orpc/bluetooth/status"];

const handler = new RPCHandler(appRouter, {
  plugins: isDev
    ? [
        new LoggingHandlerPlugin({
          logger,
          logRequestResponse: true,
          logRequestAbort: true,
        }),
      ]
    : [],
});

async function handleRequest(request: NextRequest) {
  const shouldSilence =
    isDev && IGNORED_PATHS.some((p) => request.url.includes(p));

  const { response } = await handler.handle(request, {
    prefix: "/api/orpc",
    context: {
      ...(await createORPCContext({ headers: request.headers })),
      ...(shouldSilence ? { [CONTEXT_LOGGER_SYMBOL]: silentLogger } : {}),
    },
  });

  return response ?? new Response("Not found", { status: 404 });
}

export { handleRequest as GET, handleRequest as POST };
