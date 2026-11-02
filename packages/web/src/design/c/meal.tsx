import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, Image as ImageIcon, Mic, NotebookPen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { meal } from "@/design/mock";
import { Card, Chip, ProvenancePill, Ring, SectionTitle } from "./ui";

export function MealDetail() {
  const m = meal.macros;
  const totalMs = meal.trace.reduce((a, t) => a + t.ms, 0);
  return (
    <>
      <header className="px-5 pt-5">
        <Link
          to="/design/c"
          className="-ml-2 inline-flex h-10 items-center gap-0.5 pr-2 font-bold text-primary text-sm"
        >
          <ChevronLeft className="size-5" strokeWidth={2.5} /> Today
        </Link>
        <h1 className="display mt-1 text-[28px] leading-tight">{meal.title}</h1>
        <div className="mt-2 flex items-center gap-2 font-semibold text-muted-foreground text-sm">
          <span>{meal.time}</span>
          <Chip status={meal.status} />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-10">
        <Card className="flex items-center gap-5 p-5">
          <Ring value={m.kcal} goal={2400} size={112} stroke={11}>
            <span className="display text-[28px] leading-none">{m.kcal}</span>
            <span className="mt-0.5 font-semibold text-muted-foreground text-[11px]">kcal</span>
          </Ring>
          <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-3">
            {(
              [
                ["Protein", m.protein, "var(--accent)"],
                ["Fat", m.fat, "var(--amber)"],
                ["Carbs", m.carbs, "var(--blue)"],
                ["Fiber", m.fiber, "var(--muted-foreground)"],
              ] as const
            ).map(([l, v, tone]) => (
              <div key={l} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: tone }} />
                <div>
                  <div className="display text-lg leading-none">
                    {v}
                    <span className="font-semibold text-muted-foreground text-xs"> g</span>
                  </div>
                  <div className="font-semibold text-muted-foreground text-xs">{l}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="bg-(--amber-soft) p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-(--amber) text-foreground">
              <Sparkles className="size-4" strokeWidth={2.5} />
            </span>
            <div>
              <div className="font-bold text-xs uppercase tracking-wide">One question</div>
              <p className="mt-1 font-semibold text-[15px] leading-snug">{meal.question.text}</p>
            </div>
          </div>
          <Textarea
            placeholder={meal.question.placeholder}
            className="mt-3 min-h-12 rounded-2xl border-0 bg-card font-semibold text-base shadow-none"
          />
          <div className="mt-3 flex gap-2">
            <Button className="h-12 flex-1 rounded-full font-bold">Answer</Button>
            <Button variant="ghost" className="h-12 rounded-full font-bold">
              Skip
            </Button>
          </div>
        </Card>

        <section>
          <SectionTitle aside="grams · kcal">Items</SectionTitle>
          <Card className="divide-y divide-border">
            {meal.items.map((it, i) => {
              const low = it.confidence < 0.6;
              return (
                <div
                  key={it.name}
                  className={
                    low ? `bg-(--amber-soft) px-4 py-3 ${i === 0 ? "rounded-t-[20px]" : ""}` : "px-4 py-3"
                  }
                >
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate font-bold text-[15px]">{it.name}</span>
                    <span className="display w-12 text-right">{it.grams}</span>
                    <span className="w-12 text-right font-semibold text-muted-foreground text-sm">
                      {it.kcal}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <ProvenancePill provenance={it.provenance} />
                    <span
                      className={
                        low
                          ? "font-bold text-(--amber) text-xs brightness-75"
                          : "font-semibold text-muted-foreground text-xs"
                      }
                    >
                      {Math.round(it.confidence * 100)}% sure
                    </span>
                    {low && <span className="font-semibold text-xs">· {it.note}</span>}
                  </div>
                </div>
              );
            })}
          </Card>
        </section>

        <section>
          <SectionTitle>Assumptions</SectionTitle>
          <Card className="p-4">
            <ul className="space-y-2 font-semibold text-sm">
              {meal.assumptions.map((a) => (
                <li key={a} className="flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                  {a}
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <Collapsible>
          <Card>
            <CollapsibleTrigger className="flex min-h-14 w-full items-center justify-between px-4 font-bold">
              <span>
                Analysis trace{" "}
                <span className="font-semibold text-muted-foreground">
                  · {meal.trace.length} tool calls · {(totalMs / 1000).toFixed(1)} s
                </span>
              </span>
              <ChevronDown className="size-5 text-muted-foreground" strokeWidth={2.5} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="space-y-1.5 border-border border-t px-4 py-3 font-mono text-xs">
                {meal.trace.map((t, i) => (
                  <li key={t.id} className="flex gap-2">
                    <span className="w-5 text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-bold text-accent">{t.tool}</span>{" "}
                      <span className="text-muted-foreground">{t.detail}</span>
                    </span>
                    <span className="text-muted-foreground">{t.ms} ms</span>
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible>
          <Card>
            <CollapsibleTrigger className="flex min-h-14 w-full items-center justify-between px-4 font-bold">
              <span>
                Captures <span className="font-semibold text-muted-foreground">· {meal.captures.length}</span>
              </span>
              <ChevronDown className="size-5 text-muted-foreground" strokeWidth={2.5} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="space-y-2 border-border border-t px-4 py-3 font-semibold text-sm">
                {meal.captures.map((c) => {
                  const Icon = c.kind === "voice" ? Mic : c.kind === "note" ? NotebookPen : ImageIcon;
                  return (
                    <li key={c.id} className="flex items-center gap-2">
                      <Icon className="size-4 text-accent" strokeWidth={2.5} />
                      <span className="font-bold">{c.label}</span>
                      <span className="text-muted-foreground">· {c.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </main>
    </>
  );
}
