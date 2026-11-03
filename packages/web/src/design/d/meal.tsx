import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Image as ImageIcon, Mic, NotebookPen } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { meal } from "@/design/mock";
import { Band, BlockButton, Label, ProvenanceTag, Status, Strip } from "./ui";

export function MealDetail() {
  const m = meal.macros;
  const totalMs = meal.trace.reduce((a, t) => a + t.ms, 0);
  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <Link
            to="/design/d"
            className="band-tint -ml-1 flex size-12 items-center justify-center active:opacity-70"
            aria-label="Back"
          >
            <ArrowLeft className="size-6" strokeWidth={2.5} />
          </Link>
          <Status status={meal.status} className="band-lime h-8 px-2.5" />
        </div>
        <Label className="mt-4 text-muted-foreground">{meal.time}</Label>
        <h1 className="display mt-1 text-[32px] leading-[0.95]!">{meal.title}</h1>
      </header>

      <main className="flex-1">
        <Band tone="ink" className="px-5 pt-4 pb-5">
          <div className="flex items-end justify-between">
            <div className="display text-[64px]">{m.kcal}</div>
            <Label className="pb-1 text-(--ink-muted)">kcal · preliminary</Label>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3 border-(--ink-line) border-t pt-3">
            {(
              [
                ["Prot", m.protein],
                ["Fat", m.fat],
                ["Carb", m.carbs],
                ["Fibre", m.fiber],
              ] as const
            ).map(([l, v]) => (
              <div key={l}>
                <div className="display text-[24px]">
                  {v}
                  <span className="text-(--ink-muted) text-base">g</span>
                </div>
                <Label className="mt-1 text-(--ink-muted)">{l}</Label>
              </div>
            ))}
          </div>
        </Band>

        {/* The question wants the user: lime, right under the numbers. */}
        <Band tone="lime" className="px-5 pt-4 pb-5">
          <Label className="text-(--lime-muted)">1 question</Label>
          <p className="display mt-2 text-[22px] leading-[1.1]! tracking-[-0.02em]!">{meal.question.text}</p>
          <textarea
            placeholder={meal.question.placeholder}
            className="mt-4 min-h-14 w-full bg-background p-3 font-medium text-base text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground"
          />
          <div className="mt-3 flex items-center gap-3">
            <BlockButton tone="ink" className="h-14 flex-1 text-base">
              Answer
            </BlockButton>
            <BlockButton tone="ghost" className="h-14 w-24 text-base underline underline-offset-4">
              Skip
            </BlockButton>
          </div>
        </Band>

        <Strip title="Items" meta="g · kcal" />
        <ul className="divide-y divide-border">
          {meal.items.map((it) => {
            const low = it.confidence < 0.6;
            return (
              <li key={it.name} className={low ? "bg-(--lime-soft) px-5 py-3" : "px-5 py-3"}>
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate font-bold">{it.name}</span>
                  <span className="display w-14 text-right text-xl">{it.grams}</span>
                  <span className="w-12 text-right font-medium text-muted-foreground">{it.kcal}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ProvenanceTag provenance={it.provenance} />
                  <span className="flex items-center gap-1.5 font-bold text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
                    <span className="h-1.5 w-10 bg-foreground/15">
                      <span
                        className="block h-full bg-foreground"
                        style={{ width: `${it.confidence * 100}%` }}
                      />
                    </span>
                    {Math.round(it.confidence * 100)}%
                  </span>
                  {low && <span className="font-medium text-sm">{it.note}</span>}
                </div>
              </li>
            );
          })}
        </ul>

        <Band tone="tint" className="px-5 pt-4 pb-5">
          <h2 className="display text-[22px]">Assumed</h2>
          <ul className="mt-3 space-y-2 font-medium">
            {meal.assumptions.map((a) => (
              <li key={a} className="flex gap-3">
                <span className="mt-2 size-2 shrink-0 bg-foreground" />
                {a}
              </li>
            ))}
          </ul>
        </Band>

        <div className="divide-y divide-border border-border border-b">
          <Collapsible>
            <CollapsibleTrigger className="flex h-14 w-full items-center justify-between px-5 font-bold uppercase tracking-[0.08em]">
              <span>
                Trace{" "}
                <span className="text-muted-foreground">
                  · {meal.trace.length} calls · {(totalMs / 1000).toFixed(1)}s
                </span>
              </span>
              <ChevronDown className="size-5" strokeWidth={2.5} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="band-tint divide-y divide-border font-mono text-xs">
                {meal.trace.map((t, i) => (
                  <li key={t.id} className="flex gap-2 px-5 py-2">
                    <span className="w-5 font-bold">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-bold">{t.tool}</span>{" "}
                      <span className="text-muted-foreground">{t.detail}</span>
                    </span>
                    <span className="text-muted-foreground">{t.ms}ms</span>
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
          <Collapsible>
            <CollapsibleTrigger className="flex h-14 w-full items-center justify-between px-5 font-bold uppercase tracking-[0.08em]">
              <span>
                Captures <span className="text-muted-foreground">· {meal.captures.length}</span>
              </span>
              <ChevronDown className="size-5" strokeWidth={2.5} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="band-tint divide-y divide-border font-medium text-sm">
                {meal.captures.map((c) => {
                  const Icon = c.kind === "voice" ? Mic : c.kind === "note" ? NotebookPen : ImageIcon;
                  return (
                    <li key={c.id} className="flex items-center gap-2 px-5 py-2.5">
                      <Icon className="size-4" strokeWidth={2.5} />
                      <span className="font-bold">{c.label}</span>
                      <span className="text-muted-foreground">{c.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <div className="h-8" />
      </main>
    </>
  );
}
