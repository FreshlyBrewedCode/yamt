import { createFileRoute, Link } from "@tanstack/react-router";
import { directions, screens } from "@/design/directions";

export const Route = createFileRoute("/design/")({ component: DesignIndex });

/** Spike #5: the three design directions. Mock data only, nothing here talks to the server. */
function DesignIndex() {
  return (
    <main className="flex flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="font-semibold text-2xl tracking-tight">Design directions</h1>
        <p className="text-muted-foreground text-sm">
          Spike #5. Three looks for the same screens, mock data only.
        </p>
      </header>
      {directions.map((d) => (
        <section key={d.key} className="rounded-lg border p-4">
          <h2 className="font-semibold text-lg">
            {d.key.toUpperCase()} · {d.name}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{d.blurb}</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {screens.map((s) => (
              <li key={s.slug}>
                <Link to={`/design/${d.key}${s.path}` as never} className="underline underline-offset-4">
                  {s.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/design/sheet/$dir" params={{ dir: d.key }} className="underline underline-offset-4">
                Contact sheet
              </Link>
            </li>
          </ul>
        </section>
      ))}
    </main>
  );
}
