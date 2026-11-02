// All server state goes through TanStack Query: one key per resource here, one hook per query.

import { QueryClient, useQuery } from "@tanstack/react-query";
import { apiPaths, type HealthResponse } from "@yamt/shared";
import { api } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

export const keys = {
  health: ["health"] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: () => api.get<HealthResponse>(apiPaths.health),
    refetchInterval: 30_000,
  });
}
