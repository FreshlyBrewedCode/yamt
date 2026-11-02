import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Image as ImageIcon, Mic, NotebookPen } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { meal } from "@/design/mock";
import { BigButton, Label, ProvenanceStamp, Stamp } from "./ui";

export function MealDetail() {
  const m = meal.macros;
  const totalMs = meal.trace.reduce((a, t) => a + t.ms, 0);
  return (
    <>
      <header className="px-4 pt-5">
        <div className="flex items-center justify-between">
          <Link
            to="/design/b"
            className="brick-flat flex size-12 items-center justify-center"
            aria-label="Back"
          >
            <ArrowLeft className="size-6" strokeWidth={2.5} />
          </Link>
          <Stamp status={meal.status} />
        </div>
        <Label className="mt-4 text-muted-foreground">{meal.time}</Label>
        <h1 className="display mt-1 text-[34px] leading-[0.95]!">{meal.title}</h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        <section className="brick mt-5 grid grid-cols-[1.4fr_1fr] bg-background">
          <div className="border-foreground border-r-[3px] p-4">
            <div className="display text-[64px]">{m.kcal}</div>
            <Label className="mt-2">kcal · preliminary</Label>
          </div>
          <div className="grid grid-rows-4 divide-y-[3px] divide-foreground">
            {(
              [
                ["Prot", m.protein],
                ["Fat", m.fat],
                ["Carb", m.carbs],
                ["Fibre", m.fiber],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="flex items-center justify-between px-3">
                <Label>{l}</Label>
                <span className="display text-xl">{v}g</span>
              </div>
            ))}
          </div>
        </section>

        <section className="brick mt-5 bg-(--lime) p-4">
          <Label>1 question</Label>
          <p className="display mt-2 text-[22px] leading-[1.1]! tracking-[-0.02em]!">{meal.question.text}</p>
          <textarea
            placeholder={meal.question.placeholder}
            className="mt-4 min-h-14 w-full border-[3px] border-foreground bg-background p-3 font-medium text-base placeholder:text-muted-foreground"
          />
          <div className="mt-3 flex gap-3">
            <BigButton tone="ink" className="brick h-14 flex-1 text-base">
              Answer
            </BigButton>
            <BigButton tone="ghost" className="brick-flat h-14 w-24 text-base">
              Skip
            </BigButton>
          </div>
        </section>

        <section className="mt-7">
          <div className="flex items-end justify-between border-foreground border-b-[3px] pb-2">
            <h2 className="display text-[26px]">Items</h2>
            <Label className="text-muted-foreground">g · kcal</Label>
          </div>
          <div className="divide-y-[3px] divide-foreground border-foreground border-b-[3px]">
            {meal.items.map((it) => {
              const low = it.confidence < 0.6;
              return (
                <div key={it.name} className={low ? "bg-(--lime)/50 py-3 pl-3" : "py-3"}>
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate font-bold">{it.name}</span>
                    <span className="display w-14 text-right text-xl">{it.grams}</span>
                    <span className="w-12 text-right font-medium text-muted-foreground">{it.kcal}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ProvenanceStamp provenance={it.provenance} />
                    <span className="flex h-6 items-center gap-1.5 border-2 border-foreground px-1.5 font-bold text-[10px] uppercase">
                      <span className="h-2 w-10 bg-background">
                        <span
                          className="block h-full bg-foreground"
                          style={{ width: `${it.confidence * 100}%` }}
                        />
                      </span>
                      {Math.round(it.confidence * 100)}%
                    </span>
                    {low && <span className="font-bold text-xs">{it.note}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-7">
          <h2 className="display border-foreground border-b-[3px] pb-2 text-[26px]">Assumed</h2>
          <ul className="mt-3 space-y-2 font-medium">
            {meal.assumptions.map((a) => (
              <li key={a} className="flex gap-3">
                <span className="mt-2 size-2 shrink-0 bg-foreground" />
                {a}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-7 flex flex-col gap-3">
          <Collapsible className="brick-flat">
            <CollapsibleTrigger className="flex h-14 w-full items-center justify-between px-3 font-bold uppercase tracking-wide">
              <span>
                Trace{" "}
                <span className="text-muted-foreground">
                  · {meal.trace.length} calls · {(totalMs / 1000).toFixed(1)}s
                </span>
              </span>
              <ChevronDown className="size-5" strokeWidth={2.5} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="divide-y-2 divide-foreground border-foreground border-t-[3px] font-mono text-xs">
                {meal.trace.map((t, i) => (
                  <li key={t.id} className="flex gap-2 px-3 py-2">
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
          <Collapsible className="brick-flat">
            <CollapsibleTrigger className="flex h-14 w-full items-center justify-between px-3 font-bold uppercase tracking-wide">
              <span>
                Captures <span className="text-muted-foreground">· {meal.captures.length}</span>
              </span>
              <ChevronDown className="size-5" strokeWidth={2.5} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="divide-y-2 divide-foreground border-foreground border-t-[3px] font-medium text-sm">
                {meal.captures.map((c) => {
                  const Icon = c.kind === "voice" ? Mic : c.kind === "note" ? NotebookPen : ImageIcon;
                  return (
                    <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                      <Icon className="size-4" strokeWidth={2.5} />
                      <span className="font-bold">{c.label}</span>
                      <span className="text-muted-foreground">{c.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </section>
      </main>
    </>
  );
}
