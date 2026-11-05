import { createFileRoute, Link } from "@tanstack/react-router";
import { Label } from "@/components/slab";
import { SCREENS, SCREENS2, VARIANTS, VARIANTS2 } from "@/design/plan/variants";

export const Route = createFileRoute("/design/plan/")({ component: Index });

/** Design spike: meal planning in the PWA, round 1. Three variants on mock data; nothing talks to the server. */
function Index() {
  return (
    <main className="px-5 py-6">
      <Label className="text-muted-foreground">Design spike · meal planning</Label>
      <h1 className="display mt-1 text-[36px]">Plan meals</h1>
      <p className="mt-3 font-medium text-muted-foreground">
        Three ways to request, compare, pick and cook planned meals. Mock data: a cut at 2,200 kcal, a half
        Hokkaido, two rounds of suggestions, Tue 4 – Fri 7 Nov 2026.
      </p>
      {VARIANTS.map((v) => (
        <section key={v.key} className="mt-6 border-border border-t pt-4">
          <h2 className="display text-[22px]">
            {v.key.toUpperCase()} · {v.name}
          </h2>
          <p className="mt-1 font-medium text-muted-foreground text-sm">{v.blurb}</p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-bold">
            {SCREENS.map((s) => (
              <li key={s.key}>
                <Link
                  to="/design/plan/$variant"
                  params={{ variant: v.key }}
                  search={{ screen: s.key }}
                  className="underline underline-offset-4"
                >
                  {s.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/design/plan/sheet/$variant"
                params={{ variant: v.key }}
                className="underline underline-offset-4"
              >
                Contact sheet
              </Link>
            </li>
          </ul>
        </section>
      ))}
      <h2 className="display mt-10 text-[28px]">Round 2 · the composer</h2>
      <p className="mt-2 font-medium text-muted-foreground text-sm">
        The entry point (Log | Plan) and the planning composer: a text field, a mic, a plus for attachments,
        filters and starters so nothing starts blank. The thread is the mix of round 1.
      </p>
      {VARIANTS2.map((v) => (
        <section key={v.key} className="mt-6 border-border border-t pt-4">
          <h2 className="display text-[22px]">
            {v.key.toUpperCase()} · {v.name}
          </h2>
          <p className="mt-1 font-medium text-muted-foreground text-sm">{v.blurb}</p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-bold">
            {SCREENS2.map((s) => (
              <li key={s.key}>
                <Link
                  to="/design/plan/$variant"
                  params={{ variant: v.key }}
                  search={{ screen: s.key }}
                  className="underline underline-offset-4"
                >
                  {s.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/design/plan/sheet/$variant"
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
