import { createFileRoute, Link } from "@tanstack/react-router";
import { Label } from "@/components/slab";
import { SCREENS, VARIANTS } from "@/design/calendar/variants";

export const Route = createFileRoute("/design/calendar/")({ component: Index });

/** Spike #31: three calendar overview variants on mock data. Nothing here talks to the server. */
function Index() {
  return (
    <main className="px-5 py-6">
      <Label className="text-muted-foreground">Spike #31</Label>
      <h1 className="display mt-1 text-[36px]">Calendar overview</h1>
      <p className="mt-3 font-medium text-muted-foreground">
        Three ways to show which days are tracked and how each went against its targets. Mock data, 1 Sept –
        18 Nov 2026.
      </p>
      {VARIANTS.map((v) => (
        <section key={v.key} className="mt-6 border-border border-t pt-4">
          <h2 className="display text-[22px]">
            {v.key.toUpperCase()} · {v.name}
          </h2>
          <p className="mt-1 font-medium text-muted-foreground text-sm">{v.blurb}</p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-bold">
            {SCREENS.map((s) => (
              <li key={s.slug}>
                <Link
                  to={`/design/calendar/${v.key}`}
                  search={s.search}
                  className="underline underline-offset-4"
                >
                  {s.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/design/calendar/sheet/$variant"
                params={{ variant: v.key }}
                className="underline underline-offset-4"
              >
                Contact sheet
              </Link>
            </li>
          </ul>
        </section>
      ))}
    </main>
  );
}
