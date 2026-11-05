import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlanA } from "@/design/plan/a/page";
import { PlanB } from "@/design/plan/b/page";
import { PlanC } from "@/design/plan/c/page";
import { PlanD } from "@/design/plan/round2/d";
import { PlanE } from "@/design/plan/round2/e";
import { PlanF } from "@/design/plan/round2/f";
import { SCREENS, SCREENS2, type Screen, type Screen2 } from "@/design/plan/variants";

const isScreen = (s: unknown): s is Screen => SCREENS.some((x) => x.key === s);
const isScreen2 = (s: unknown): s is Screen2 => SCREENS2.some((x) => x.key === s);

export const Route = createFileRoute("/design/plan/$variant")({
  validateSearch: (search: Record<string, unknown>): { screen: Screen | Screen2 } => ({
    screen: isScreen(search.screen) || isScreen2(search.screen) ? search.screen : "overview",
  }),
  component: () => {
    const { variant } = Route.useParams();
    const { screen } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const go = (s: Screen | Screen2) => void navigate({ search: { screen: s }, replace: true });
    const s1 = isScreen(screen) ? screen : "overview";
    const s2 = isScreen2(screen) ? screen : "overview";
    if (variant === "a") return <PlanA screen={s1} go={go} />;
    if (variant === "b") return <PlanB screen={s1} go={go} />;
    if (variant === "c") return <PlanC screen={s1} go={go} />;
    if (variant === "d") return <PlanD screen={s2} go={go} />;
    if (variant === "e") return <PlanE screen={s2} go={go} />;
    if (variant === "f") return <PlanF screen={s2} go={go} />;
    return <p className="p-4">Unknown variant.</p>;
  },
});
