import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Shell } from "@/design/b/shell";

export const Route = createFileRoute("/design/b")({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
