import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Shell } from "@/design/a/shell";

export const Route = createFileRoute("/design/a")({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
