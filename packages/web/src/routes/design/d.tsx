import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Shell } from "@/design/d/shell";

export const Route = createFileRoute("/design/d")({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
