import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Shell } from "@/design/c/shell";

export const Route = createFileRoute("/design/c")({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
