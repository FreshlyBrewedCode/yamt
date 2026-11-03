import type { Confidence, MealItemView, Provenance } from "@yamt/shared";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { formatGrams, formatNumber } from "@/lib/format";
import { Label } from "./slab";

const provenanceText: Record<Provenance, string> = {
  weighed: "Weighed",
  label: "Label",
  database: "Database",
  estimate: "Estimate",
};

/**
 * Where an item's numbers come from, as a marker and a micro-label: weighed (solid), label
 * (half), database (open square), estimate (faint). Shapes, not colours: lime stays for what
 * wants the user.
 */
export function ProvenanceTag({ provenance, className }: { provenance: Provenance; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-[0.08em]",
        className,
      )}
      data-provenance={provenance}
    >
      <span
        className={cn(
          "size-2.5 shrink-0",
          provenance === "weighed" && "bg-current",
          provenance === "label" && "bg-current/50",
          provenance === "database" && "border-2 border-current",
          provenance === "estimate" && "bg-current/15",
        )}
      />
      {provenanceText[provenance]}
    </span>
  );
}

const confidenceSteps: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
const confidenceText: Record<Confidence, string> = { low: "Low", medium: "Medium", high: "High" };

/** Three segments, filled by confidence, and the word. */
export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const n = confidenceSteps[confidence];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-bold text-[11px] text-muted-foreground uppercase tracking-[0.08em]"
      data-confidence={confidence}
    >
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1.5 w-3", i <= n ? "bg-foreground" : "bg-foreground/15")} />
        ))}
      </span>
      {confidenceText[confidence]}
    </span>
  );
}

const sourceText = {
  off: "Open Food Facts",
  fdc: "USDA FoodData Central",
  label: "Package label",
  custom: "Custom food",
} as const;

/** A public page for the food's source entry, where there is one. */
function sourceUrl(food: NonNullable<MealItemView["food"]>): string | null {
  if (!food.sourceRef) return null;
  if (food.source === "off")
    return `https://world.openfoodfacts.org/product/${encodeURIComponent(food.sourceRef)}`;
  if (food.source === "fdc")
    return `https://fdc.nal.usda.gov/food-details/${encodeURIComponent(food.sourceRef)}/nutrients`;
  return null;
}

const PER_100: [keyof MealItemView["per100g"], string, string][] = [
  ["energyKcal", "kcal", ""],
  ["protein", "Prot", "g"],
  ["fat", "Fat", "g"],
  ["carbohydrate", "Carb", "g"],
  ["fiber", "Fibre", "g"],
];

/**
 * The items of a revision: what, grams, kcal; provenance and confidence underneath. Low
 * confidence fills the row with lime-soft and shows the agent's note. Tapping a row opens its
 * source: the matched food, its per-100 g numbers and this item's share.
 */
export function ItemsList({ items }: { items: MealItemView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) {
    return (
      <p className="px-5 py-6 font-medium text-muted-foreground">
        No items: the analysis found nothing to count.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border" data-testid="items">
      {items.map((it) => {
        const low = it.confidence === "low";
        const expanded = open === it.id;
        return (
          <li
            key={it.id}
            className={cn(low && "bg-lime-soft")}
            data-testid="item"
            data-confidence={it.confidence}
          >
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : it.id)}
              aria-expanded={expanded}
              className="block min-h-[68px] w-full px-5 py-3 text-left outline-none focus-visible:bg-tint"
            >
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate font-bold">{it.description}</span>
                <span className="display text-xl">
                  {formatGrams(it.grams)}
                  <span className="font-bold text-muted-foreground text-xs">g</span>
                </span>
                <span className="w-12 text-right font-medium text-muted-foreground">
                  {it.nutrients.energyKcal === null ? "—" : formatNumber(it.nutrients.energyKcal)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <ProvenanceTag provenance={it.provenance} />
                <ConfidenceMeter confidence={it.confidence} />
                <ChevronDown
                  className={cn(
                    "ml-auto size-4 text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                  )}
                  strokeWidth={2.5}
                />
              </div>
              {it.note && (low || expanded) && <p className="mt-1.5 font-medium text-sm">{it.note}</p>}
            </button>
            {expanded && <ItemSource item={it} />}
          </li>
        );
      })}
    </ul>
  );
}

function ItemSource({ item }: { item: MealItemView }) {
  const food = item.food;
  const url = food ? sourceUrl(food) : null;
  return (
    <div className="px-5 pb-4" data-testid="item-source">
      <Label className="text-muted-foreground">Source</Label>
      {food ? (
        <p className="mt-1 font-medium">
          <span className="font-bold">{food.name}</span>
          {food.brand && ` · ${food.brand}`}
          <br />
          <span className="text-muted-foreground text-sm">
            {sourceText[food.source]}
            {food.sourceRef && ` · ${food.sourceRef}`}
            {url && (
              <>
                {" · "}
                <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  open
                </a>
              </>
            )}
          </span>
        </p>
      ) : (
        <p className="mt-1 font-medium text-sm">The agent's own estimate, no food from a database.</p>
      )}
      <div className="mt-3 grid grid-cols-5 gap-2">
        {PER_100.map(([key, label, unit]) => (
          <div key={key}>
            <div className="display text-lg">
              {item.per100g[key] === null ? "—" : formatGrams(item.per100g[key])}
              <span className="font-bold text-[10px] text-muted-foreground">{unit}</span>
            </div>
            <Label className="text-[10px] text-muted-foreground">{label}</Label>
          </div>
        ))}
      </div>
      <Label className="mt-1 text-[10px] text-muted-foreground normal-case tracking-normal">
        per 100 g · this item: {formatGrams(item.grams)} g →{" "}
        {PER_100.slice(1)
          .map(
            ([key, label]) =>
              `${label} ${item.nutrients[key] === null ? "—" : formatGrams(item.nutrients[key])} g`,
          )
          .join(" · ")}
      </Label>
    </div>
  );
}
