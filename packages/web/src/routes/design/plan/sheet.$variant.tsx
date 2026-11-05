import { createFileRoute } from "@tanstack/react-router";
import { SCREENS, SCREENS2, VARIANTS, VARIANTS2 } from "@/design/plan/variants";

export const Route = createFileRoute("/design/plan/sheet/$variant")({ component: Sheet });

/** Tall enough for each screen's whole page, so the bottom slab sits right under the content. */
const HEIGHT: Record<string, number> = {
  overview: 1150,
  request: 1250,
  suggesting: 1900,
  suggestions: 2700,
  recipe: 2300,
  plan: 1300,
  ate: 1150,
};

/** Round 2: the keyboard screens are the phone's height (the keyboard is part of the screen). */
const HEIGHT2: Record<string, number> = {
  overview: 1400,
  empty: 1500,
  typing: 844,
  attached: 1600,
  suggesting: 1150,
  suggestions: 2500,
  steer: 844,
  round2: 3500,
  plan: 1300,
};

/** All screens of one variant side by side (iframes at phone size, tall enough for the whole page). */
function Sheet() {
  const { variant } = Route.useParams();
  const v1 = VARIANTS.find((x) => x.key === variant);
  const v2 = VARIANTS2.find((x) => x.key === variant);
  const v = v1 ?? v2;
  if (!v) return <p className="p-4">Unknown variant.</p>;
  const screens = v1 ? SCREENS : SCREENS2;
  const heights = v1 ? HEIGHT : HEIGHT2;
  return (
    <div className="fixed inset-0 overflow-auto bg-neutral-200 p-6 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
      <h1 className="mb-1 font-semibold text-xl">
        {v.key.toUpperCase()} · {v.name}
      </h1>
      <p className="mb-4 max-w-3xl text-neutral-600 text-sm dark:text-neutral-400">{v.blurb}</p>
      <div className="flex gap-6">
        {screens.map((s) => (
          <figure key={s.key} className="shrink-0">
            <iframe
              title={s.label}
              src={`/design/plan/${v.key}?screen=${s.key}`}
              width={390}
              height={heights[s.key]}
              className="block bg-white"
            />
            <figcaption className="mt-2 w-[390px] text-center text-neutral-600 text-sm dark:text-neutral-400">
              {s.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
