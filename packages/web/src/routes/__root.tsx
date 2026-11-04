import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="mx-auto flex min-h-[inherit] w-full max-w-md flex-col">
      <Outlet />
    </div>
  ),
});
