import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, CircleHelp, Image as ImageIcon, Mic, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { meal } from "@/design/mock";
import { Confidence, Eyebrow, ProvenanceTag, Rule, Status } from "./ui";

export function MealDetail() {
  const m = meal.macros;
  const totalMs = meal.trace.reduce((a, t) => a + t.ms, 0);
  return (
    <>
      <header className="px-5 pt-4 pb-3">
        <Link to="/design/a" className="-ml-1 inline-flex items-center gap-0.5 text-muted-foreground text-sm">
          <ChevronLeft className="size-4" /> Today
        </Link>
        <h1 className="display mt-2 text-[30px] leading-[1.05]">{meal.title}</h1>
        <div className="mt-2 flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{meal.time}</span>
          <Status status={meal.status} detail="1 question" />
        </div>
      </header>

      <main className="flex-1 pb-10">
        <section className="px-5">
          <div className="flex items-baseline gap-2">
            <span className="display text-[44px] leading-none">{m.kcal}</span>
            <span className="text-muted-foreground text-sm">kcal · preliminary</span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-4">
            {(
              [
                ["Protein", m.protein],
                ["Fat", m.fat],
                ["Carbs", m.carbs],
                ["Fiber", m.fiber],
              ] as const
            ).map(([l, v]) => (
              <div key={l}>
                <Eyebrow>{l}</Eyebrow>
                <div className="display mt-0.5 text-lg">
                  {v}
                  <span className="font-sans text-muted-foreground text-xs"> g</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <div className="px-5 pb-2">
            <Eyebrow>Open question</Eyebrow>
          </div>
          <div className="relative border-border border-y bg-(--attention-soft) px-5 py-4">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-(--attention)" />
            <p className="flex gap-2 text-sm">
              <CircleHelp className="mt-0.5 size-4 shrink-0 text-(--attention)" />
              {meal.question.text}
            </p>
            <Textarea
              placeholder={meal.question.placeholder}
              className="mt-3 min-h-11 rounded-sm bg-background text-base"
            />
            <div className="mt-2 flex gap-2">
              <Button className="h-11 flex-1 rounded-sm">Answer and re-analyse</Button>
              <Button variant="outline" className="h-11 rounded-sm">
                Skip
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-baseline justify-between px-5 pb-2">
            <Eyebrow>Items · {meal.items.length}</Eyebrow>
            <Eyebrow>g · kcal</Eyebrow>
          </div>
          <Rule />
          {meal.items.map((it) => {
            const low = it.confidence < 0.6;
            return (
              <div key={it.name} className="relative border-border border-b px-5 py-2.5">
                {low && <span className="absolute inset-y-2 left-0 w-[3px] bg-(--attention)" />}
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-[15px]">{it.name}</span>
                  <span className="w-12 text-right text-sm">{it.grams}</span>
                  <span className="w-12 text-right text-muted-foreground text-sm">{it.kcal}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <ProvenanceTag provenance={it.provenance} />
                  <Confidence value={it.confidence} />
                  {low && <span className="text-(--attention) text-xs">{it.note}</span>}
                </div>
              </div>
            );
          })}
        </section>

        <section className="mt-6 px-5">
          <Eyebrow>Assumptions</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-sm">
            {meal.assumptions.map((a) => (
              <li key={a} className="flex gap-2">
                <span className="text-muted-foreground">–</span>
                {a}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6">
          <Rule />
          <Collapsible>
            <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between px-5 text-sm">
              <span>
                Analysis trace{" "}
                <span className="text-muted-foreground">
                  · {meal.trace.length} tool calls · {(totalMs / 1000).toFixed(1)} s
                </span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="space-y-1.5 px-5 pb-4 font-mono text-xs">
                {meal.trace.map((t, i) => (
                  <li key={t.id} className="flex gap-2">
                    <span className="w-5 text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="text-accent">{t.tool}</span>{" "}
                      <span className="text-muted-foreground">{t.detail}</span>
                    </span>
                    <span className="text-muted-foreground">{t.ms} ms</span>
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
          <Rule />
          <Collapsible>
            <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between px-5 text-sm">
              <span>
                Captures <span className="text-muted-foreground">· {meal.captures.length}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="space-y-2 px-5 pb-4 text-sm">
                {meal.captures.map((c) => {
                  const Icon = c.kind === "voice" ? Mic : c.kind === "note" ? NotebookPen : ImageIcon;
                  return (
                    <li key={c.id} className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" />
                      <span>{c.label}</span>
                      <span className="text-muted-foreground">· {c.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
          <Rule />
        </section>
      </main>
    </>
  );
}
