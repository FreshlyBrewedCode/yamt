// Leftovers on the plan view (#49, G's plan view): a cooked leftover offered on a day ("Leftover · 1
// portion", Plan it), the Leftovers list (a tap marks one used or gone; Add a leftover), its two
// top sheets, and the row into the shopping list.
import { Link } from "@tanstack/react-router";
import { type LeftoverView, leftoverAmount, type MealSlot, type ShoppingListResponse } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, Check, Plus, ShoppingBasket, Trash2, Utensils } from "lucide-react";
import { useState } from "react";
import { formatNumber, formatWeekday } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { leftoverLine } from "@/lib/leftovers";
import { slotWords } from "@/lib/plan-request";
import { SLOT_NAME } from "@/lib/planning";
import { planError, useCreateLeftover, usePlanLeftover, useSetLeftoverStatus } from "@/lib/queries";
import { CaptureSheet, fieldClass } from "./add-strip";
import { portions } from "./planning";
import { Label, SlabButton, Strip } from "./slab";

/** A slot of a day the plan offers a leftover for. */
export interface OfferAt {
  date: string;
  slot: MealSlot;
}

/**
 * A cooked leftover offered on a day (G): quiet like a planned row, "Leftover · 1 portion" with the
 * fork and knife, the title muted, "Cooked Tue · offered for lunch", one portion's kcal; a 64 px
 * tint **Plan it** square on the right puts it on that slot.
 */
export function LeftoverOfferRow({ leftover: l, at }: { leftover: LeftoverView; at: OfferAt }) {
  const plan = usePlanLeftover();
  // one id per row: a retry after a lost response answers the same planned meal
  const [id] = useState(() => uuidv7());
  const eat = Math.min(1, l.available ?? 1);
  const kcal = (l.perPortion?.nutrients.energyKcal ?? 0) * eat;
  return (
    <li className="flex min-h-[84px] flex-col" data-testid="leftover-offer" data-leftover={l.id}>
      <div className="flex min-h-[84px] items-stretch">
        <div className="flex min-w-0 flex-1 items-stretch gap-4 px-5 py-3">
          <div className="min-w-0 flex-1">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <Utensils className="size-3.5 shrink-0" strokeWidth={2.5} />
              Leftover · {portions(eat)} {eat === 1 ? "portion" : "portions"}
            </Label>
            <div className="display mt-1.5 text-[19px] text-muted-foreground leading-[1.05] tracking-[-0.02em]">
              {l.description}
            </div>
            <div className="mt-1.5 font-medium text-muted-foreground text-xs">
              {l.cookedOn ? `Cooked ${formatWeekday(l.cookedOn)}` : "Cooked"} · offered for{" "}
              {SLOT_NAME[at.slot].toLowerCase()}
            </div>
          </div>
          {l.perPortion && (
            <div className="shrink-0 text-right text-muted-foreground">
              <div className="display text-[26px]">{formatNumber(kcal)}</div>
              <Label className="text-[10px]">kcal</Label>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            plan.mutate({ leftoverId: l.id, body: { id, date: at.date, slot: at.slot, portionEaten: eat } })
          }
          disabled={plan.isPending}
          aria-label={`Plan it: ${l.description}, ${SLOT_NAME[at.slot].toLowerCase()}`}
          className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 bg-tint outline-none active:bg-lime active:text-lime-foreground focus-visible:underline disabled:text-muted-foreground"
          data-testid="plan-it"
        >
          <Plus className="size-6" strokeWidth={2.5} />
          <Label className="text-[10px]">{plan.isPending ? "…" : "Plan it"}</Label>
        </button>
      </div>
      {plan.isError && (
        <Label
          className="bg-orange px-5 py-2 text-orange-foreground normal-case tracking-normal"
          role="alert"
        >
          {planError(plan.error, "planning a leftover")}
        </Label>
      )}
    </li>
  );
}

/**
 * The Leftovers list (G): a strip "Leftovers · at home now", each open one as a plain row (the name
 * bold, where it comes from muted, how much on the right); a tap opens its sheet (Plan it for a
 * cooked one, Used it, Gone). The last row adds one.
 */
export function LeftoversSection({
  leftovers,
  offers,
  today,
}: {
  leftovers: readonly LeftoverView[];
  offers: ReadonlyMap<string, OfferAt>;
  today: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const shown = leftovers.find((l) => l.id === open) ?? null;
  return (
    <section aria-label="Leftovers" data-testid="leftovers">
      <Strip title="Leftovers" meta={leftovers.length ? "at home now" : "nothing noted"} />
      <ul className="divide-y divide-border">
        {leftovers.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => setOpen(l.id)}
              className="flex min-h-14 w-full items-center gap-4 px-5 py-2.5 text-left outline-none active:bg-tint focus-visible:bg-tint"
              data-testid="leftover-row"
              data-source={l.source}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block font-bold text-[15px] leading-snug",
                    l.source === "cooked" && "text-muted-foreground",
                  )}
                >
                  {l.description}
                </span>
                <span className="block font-medium text-muted-foreground text-xs">
                  {leftoverLine(l, offers.get(l.id), today)}
                </span>
              </span>
              <span className="shrink-0 font-bold text-sm">{leftoverAmount(l)}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-14 w-full items-center gap-3 px-5 text-left font-bold text-sm uppercase tracking-[0.08em] outline-none active:bg-tint focus-visible:bg-tint"
            data-testid="add-leftover"
          >
            <Plus className="size-5" strokeWidth={2.5} /> Add a leftover
          </button>
        </li>
      </ul>
      <LeftoverSheet
        leftover={shown}
        offer={shown ? offers.get(shown.id) : undefined}
        today={today}
        onClose={() => setOpen(null)}
      />
      <AddLeftoverSheet open={adding} onClose={() => setAdding(false)} />
    </section>
  );
}

/**
 * A leftover's sheet: what it is and how much, **Plan it · Tomorrow lunch** for a cooked one the
 * plan offers (lime: it wants the user), then two plain 56 px rows, **Used it** and **Gone**.
 */
function LeftoverSheet({
  leftover,
  offer,
  today,
  onClose,
}: {
  leftover: LeftoverView | null;
  offer: OfferAt | undefined;
  today: string;
  onClose: () => void;
}) {
  // kept while the sheet slides out, so its content doesn't vanish first
  const [shown, setShown] = useState<LeftoverView | null>(leftover);
  if (leftover && leftover !== shown) setShown(leftover);
  const status = useSetLeftoverStatus();
  const plan = usePlanLeftover();
  const [id, setId] = useState(() => uuidv7());
  const l = shown;
  const amount = l ? leftoverAmount(l) : "";
  const close = () => {
    status.reset();
    plan.reset();
    setId(uuidv7());
    onClose();
  };
  const error = status.error ?? plan.error;
  return (
    <CaptureSheet
      open={leftover !== null}
      onClose={close}
      title={l?.description ?? ""}
      description={`Leftover${amount ? ` · ${amount}` : ""}`}
    >
      {l && (
        <div data-testid="leftover-sheet">
          <p className="px-5 pb-4 font-medium text-muted-foreground text-sm">
            {leftoverLine(l, offer, today)}
          </p>
          {error && (
            <Label
              className="bg-orange px-5 py-2.5 text-orange-foreground normal-case tracking-normal"
              role="alert"
            >
              {planError(error, "changing the leftovers")}
            </Label>
          )}
          {offer && (
            <SlabButton
              onClick={() =>
                plan.mutate(
                  {
                    leftoverId: l.id,
                    body: {
                      id,
                      date: offer.date,
                      slot: offer.slot,
                      portionEaten: Math.min(1, l.available ?? 1),
                    },
                  },
                  { onSuccess: close },
                )
              }
              disabled={plan.isPending}
              data-testid="leftover-plan-it"
            >
              <Plus className="size-7" strokeWidth={3} />{" "}
              {plan.isPending ? "Planning…" : `Plan it · ${slotWords(offer, today)}`}
            </SlabButton>
          )}
          <div className="divide-y divide-border border-border border-b">
            {(
              [
                ["used", "Used it", "Eaten or cooked with: off the list.", Check],
                ["gone", "Gone", "Thrown away, or not there after all.", Trash2],
              ] as const
            ).map(([s, title, detail, Icon]) => (
              <button
                key={s}
                type="button"
                onClick={() => status.mutate({ id: l.id, status: s }, { onSuccess: close })}
                disabled={status.isPending}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left outline-none active:bg-tint focus-visible:bg-tint"
                data-testid={`leftover-${s}`}
              >
                <span>
                  <span className="block font-bold uppercase tracking-[0.08em]">{title}</span>
                  <span className="block font-medium text-muted-foreground text-sm">{detail}</span>
                </span>
                <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
              </button>
            ))}
          </div>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}
    </CaptureSheet>
  );
}

/** Add a leftover: what it is, how much as said ("½", "1 bunch"), grams if known; lime Add. */
function AddLeftoverSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [what, setWhat] = useState("");
  const [quantity, setQuantity] = useState("");
  const [grams, setGrams] = useState("");
  const [id, setId] = useState(() => uuidv7());
  const create = useCreateLeftover();
  const g = grams.trim() ? Number(grams.replace(",", ".")) : null;
  const valid = what.trim().length > 0 && (g === null || (Number.isFinite(g) && g > 0));
  const close = () => {
    setWhat("");
    setQuantity("");
    setGrams("");
    setId(uuidv7());
    create.reset();
    onClose();
  };
  const add = () => {
    if (!valid || create.isPending) return;
    create.mutate(
      {
        id,
        description: what.trim(),
        ...(quantity.trim() ? { quantity: quantity.trim() } : {}),
        ...(g !== null ? { grams: g } : {}),
      },
      { onSuccess: close },
    );
  };
  return (
    <CaptureSheet open={open} onClose={close} title="Leftover" description="At home, to use up">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        data-testid="add-leftover-sheet"
      >
        <input
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="What: e.g. Hokkaido"
          aria-label="What"
          maxLength={120}
          enterKeyHint="next"
          className={`${fieldClass} h-16`}
        />
        <div className="flex border-border border-t">
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="How much: ½, 1 bunch"
            aria-label="How much"
            maxLength={40}
            className={`${fieldClass} h-16 min-w-0 flex-1`}
          />
          <input
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            inputMode="decimal"
            placeholder="g"
            aria-label="Grams"
            className={`${fieldClass} h-16 w-28 shrink-0 border-border border-l text-right`}
          />
        </div>
        {create.isError && (
          <Label
            className="bg-orange px-5 py-2.5 text-orange-foreground normal-case tracking-normal"
            role="alert"
          >
            {planError(create.error, "adding a leftover")}
          </Label>
        )}
        <SlabButton type="submit" disabled={!valid || create.isPending}>
          {create.isPending ? "Adding…" : "Add leftover"}
        </SlabButton>
      </form>
    </CaptureSheet>
  );
}

/** "Tue–Thu", "Wed": a range of days in words. */
export function rangeLabel(from: string, to: string): string {
  return from === to ? formatWeekday(from) : `${formatWeekday(from)}–${formatWeekday(to)}`;
}

/** The plan view's last row (G): the shopping list for the plan's days, "Tue–Thu · 14 to buy". */
export function ShoppingRow({ list }: { list: ShoppingListResponse | undefined }) {
  return (
    <Link
      to="/plan/shopping"
      className="flex min-h-16 items-center justify-between gap-3 bg-tint px-5 py-3 outline-none active:opacity-80 focus-visible:underline"
      data-testid="shopping-row"
    >
      <span className="flex items-center gap-3 font-bold uppercase tracking-[0.08em]">
        <ShoppingBasket className="size-5" strokeWidth={2.5} /> Shopping list
      </span>
      <Label className="flex items-center gap-1.5 text-muted-foreground">
        {list ? `${rangeLabel(list.from, list.to)} · ${list.toBuy - list.inBasket} to buy` : ""}
        <ArrowRight className="size-4" strokeWidth={2.5} />
      </Label>
    </Link>
  );
}
