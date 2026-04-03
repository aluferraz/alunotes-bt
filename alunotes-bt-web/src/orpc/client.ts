import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import type { appRouter } from "~/server/api/root";

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

const link = new RPCLink({
  url: getBaseUrl() + "/api/orpc",
  headers: () => ({
    "x-orpc-source": "nextjs-react",
  }),
});

export const client: RouterClient<typeof appRouter> =
  createORPCClient(link);
