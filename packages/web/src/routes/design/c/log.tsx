import { createFileRoute } from "@tanstack/react-router";
import { Log } from "@/design/c/log";

export const Route = createFileRoute("/design/c/log")({
  validateSearch: (search: Record<string, unknown>): { state?: "recording" } =>
    search.state === "recording" ? { state: "recording" } : {},
  component: () => <Log state={Route.useSearch().state ?? "idle"} />,
});
