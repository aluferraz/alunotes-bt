import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import { StandardRPCJsonSerializer } from "@orpc/client/standard";

const serializer = new StandardRPCJsonSerializer();

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        queryKeyHashFn(queryKey) {
          const [json, meta] = serializer.serialize(queryKey);
          return JSON.stringify({ json, meta });
        },
      },
      dehydrate: {
        serializeData(data) {
          const [json, meta] = serializer.serialize(data);
          return { json, meta };
        },
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData(data: { json: unknown; meta: unknown }) {
          return serializer.deserialize(
            data.json,
            data.meta as Parameters<typeof serializer.deserialize>[1],
          );
        },
      },
    },
  });
