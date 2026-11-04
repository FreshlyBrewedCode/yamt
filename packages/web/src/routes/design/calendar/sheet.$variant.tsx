import { createFileRoute } from "@tanstack/react-router";
import { SCREENS, VARIANTS } from "@/design/calendar/variants";

export const Route = createFileRoute("/design/calendar/sheet/$variant")({ component: Sheet });

/** All screens of one variant side by side (iframes at phone size, tall enough for the whole page). */
function Sheet() {
  const { variant } = Route.useParams();
  const v = VARIANTS.find((x) => x.key === variant);
  if (!v) return <p className="p-4">Unknown variant.</p>;
  return (
    <div className="fixed inset-0 overflow-auto bg-neutral-200 p-6 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
      <h1 className="mb-1 font-semibold text-xl">
        {v.key.toUpperCase()} · {v.name}
      </h1>
      <p className="mb-4 max-w-3xl text-neutral-600 text-sm dark:text-neutral-400">{v.blurb}</p>
      <div className="flex gap-6">
        {SCREENS.map((s) => {
          const q = new URLSearchParams(s.search as Record<string, string>).toString();
          return (
            <figure key={s.slug} className="shrink-0">
              <iframe
                title={s.label}
                src={`/design/calendar/${v.key}${q ? `?${q}` : ""}`}
                width={390}
                height={2160}
                className="block bg-white"
              />
              <figcaption className="mt-2 text-center text-neutral-600 text-sm dark:text-neutral-400">
                {s.label}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
