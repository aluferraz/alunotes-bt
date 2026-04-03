import "server-only";

import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { cache } from "react";

import { appRouter } from "~/server/api/root";
import { createORPCContext } from "~/server/api/orpc";
import { createQueryClient } from "./query-client";

const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-orpc-source", "rsc");

  return createORPCContext({
    headers: heads,
  });
});

export const getQueryClient = cache(createQueryClient);

const serverClient = createRouterClient(appRouter, {
  context: createContext,
});

export const api = createTanstackQueryUtils(serverClient);

export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
}
