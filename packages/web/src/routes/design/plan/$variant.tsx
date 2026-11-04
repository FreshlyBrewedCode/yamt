import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlanA } from "@/design/plan/a/page";
import { PlanB } from "@/design/plan/b/page";
import { PlanC } from "@/design/plan/c/page";
import { SCREENS, type Screen } from "@/design/plan/variants";

const isScreen = (s: unknown): s is Screen => SCREENS.some((x) => x.key === s);

export const Route = createFileRoute("/design/plan/$variant")({
  validateSearch: (search: Record<string, unknown>): { screen: Screen } => ({
    screen: isScreen(search.screen) ? search.screen : "overview",
  }),
  component: () => {
    const { variant } = Route.useParams();
    const { screen } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const go = (s: Screen) => void navigate({ search: { screen: s }, replace: true });
    if (variant === "a") return <PlanA screen={screen} go={go} />;
    if (variant === "b") return <PlanB screen={screen} go={go} />;
    if (variant === "c") return <PlanC screen={screen} go={go} />;
    return <p className="p-4">Unknown variant.</p>;
  },
});
