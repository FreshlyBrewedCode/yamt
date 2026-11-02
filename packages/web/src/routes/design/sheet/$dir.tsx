import { createFileRoute } from "@tanstack/react-router";
import { directions, screens } from "@/design/directions";

export const Route = createFileRoute("/design/sheet/$dir")({ component: Sheet });

/** All screens of one direction side by side (iframes at phone size), for the contact sheet. */
function Sheet() {
  const { dir } = Route.useParams();
  const direction = directions.find((d) => d.key === dir);
  if (!direction) return <p className="p-4">Unknown direction.</p>;
  return (
    <div className="fixed inset-0 overflow-auto bg-neutral-200 p-6 text-neutral-900">
      <h1 className="mb-4 font-semibold text-xl">
        {direction.key.toUpperCase()} · {direction.name}
      </h1>
      <div className="flex gap-6">
        {screens.map((s) => (
          <figure key={s.slug} className="shrink-0">
            <iframe
              title={s.label}
              src={`/design/${direction.key}${s.path}`}
              width={390}
              height={844}
              className="block rounded-[28px] border-[6px] border-neutral-800 bg-white shadow-xl"
            />
            <figcaption className="mt-2 text-center text-neutral-600 text-sm">{s.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
