import { createFileRoute } from "@tanstack/react-router";
import { Log } from "@/design/a/log";

export const Route = createFileRoute("/design/a/log")({
  validateSearch: (search: Record<string, unknown>): { state?: "recording" } =>
    search.state === "recording" ? { state: "recording" } : {},
  component: () => <Log state={Route.useSearch().state ?? "idle"} />,
});
