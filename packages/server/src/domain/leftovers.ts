import {
  addDays,
  type CreateLeftoverBody,
  type Leftover,
  type LeftoverOffer,
  type LeftoverStatus,
  type LeftoverView,
  type MealSlot,
  type PlanDay,
  type PlannedMeal,
  PORTION_EPSILON,
  portionItems,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { fold } from "../nutrition/aisles.ts";
import { HttpError } from "./errors.ts";
import { nutrientTotals } from "./meals.ts";
import { recipeTotals } from "./recipes.ts";

/** Portions to 0.01, as planned meals keep them. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A pack the planning agent noted (`note_leftover`). */
export interface NoteLeftover {
  /** The suggestion of the round that leaves it over (its outline position). */
  position?: number;
  description: string;
  quantity?: string;
  grams?: number;
  foodId?: string;
  note?: string;
}

/**
 * The cooked leftover after its planned meal was logged ("Ate it", or a removed meal restored), in
 * the caller's transaction: a leftover planned meal takes what it ate off its leftover (used once
 * nothing is left); one cooked for more portions than eaten makes a `cooked` leftover of the rest
 * (unless one is there already: a restore of a meal whose leftover was eaten from meanwhile).
 */
export function leftoverAfterLog(repos: Repos, p: PlannedMeal, now: number): void {
  if (p.leftoverOf) {
    const l = repos.leftovers.ofPlannedMeal(p.leftoverOf);
    if (!l || l.portions === null) return;
    const left = Math.max(0, round2(l.portions - p.portionEaten));
    const status: LeftoverStatus = l.status === "open" && left < PORTION_EPSILON ? "used" : l.status;
    repos.leftovers.setPortions(l.id, left, status, now);
    return;
  }
  const extra = round2(p.portionsCooked - p.portionEaten);
  if (extra < PORTION_EPSILON || repos.leftovers.ofPlannedMeal(p.id)) return;
  repos.leftovers.insert({
    description: p.title,
    portions: extra,
    source: "cooked",
    plannedMealId: p.id,
    recipeId: p.recipeId,
    cookedOn: p.date,
    now,
  });
}

/**
 * The meal a planned meal logged was removed (it is `planned` again), in the caller's
 * transaction: a leftover planned meal gives what it ate back to its leftover (open again if it
 * was used up); a planned meal's own cooked leftover is taken back unless something was eaten from
 * it (a leftover planned meal of it is logged).
 */
export function leftoverAfterUnlog(repos: Repos, p: PlannedMeal, portionEaten: number, now: number): void {
  if (p.leftoverOf) {
    const l = repos.leftovers.ofPlannedMeal(p.leftoverOf);
    if (!l || l.portions === null) return;
    repos.leftovers.setPortions(
      l.id,
      l.portions + portionEaten,
      l.status === "used" ? "open" : l.status,
      now,
    );
    return;
  }
  const own = repos.leftovers.ofPlannedMeal(p.id);
  if (!own) return;
  if (repos.plannedMeals.leftoversOf(p.id).some((x) => x.status === "logged")) return;
  repos.leftovers.delete(own.id);
}

/** The words of a name for matching ("½ Hokkaido" ~ "Hokkaido-Kürbis"): folded, digits dropped. */
export const nameWords = (s: string): string[] =>
  fold(s)
    .split(" ")
    .filter((w) => w.length > 1 && !/^\d/.test(w));

/** Two names of the same thing: every word of the shorter one is in the longer one. */
export function sameThing(a: string, b: string): boolean {
  const wa = nameWords(a);
  const wb = nameWords(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const [short, long] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  return short.every((w) => long.has(w));
}

/**
 * The leftovers list (#49): views of the open ones (a cooked one with what is not planned yet,
 * where it is planned and one portion's numbers), the user's own lines, used / gone and back, and
 * the packs the planning agent notes. "Plan it" is `PlanningService.planLeftover`; what "Ate it"
 * and removing a meal do to leftovers is `leftoverAfterLog` / `leftoverAfterUnlog`.
 */
export class LeftoverService {
  constructor(
    private readonly repos: Repos,
    private readonly now: () => number = Date.now,
  ) {}

  /** The open ones, oldest first. */
  list(): LeftoverView[] {
    return this.views(this.repos.leftovers.listOpen());
  }

  get(id: string): LeftoverView {
    return this.views([this.leftover(id)])[0]!;
  }

  /** One of the user's own. Idempotent with a client `id`. */
  create(body: CreateLeftoverBody): { leftover: LeftoverView; created: boolean } {
    if (body.id) {
      const existing = this.repos.leftovers.get(body.id);
      if (existing) {
        if (existing.source !== "user" || existing.description !== body.description)
          throw new HttpError(409, "id: another leftover has this id");
        return { leftover: this.get(existing.id), created: false };
      }
    }
    const l = this.repos.leftovers.insert({
      id: body.id,
      description: body.description,
      quantity: body.quantity || null,
      grams: body.grams ?? null,
      note: body.note || null,
      source: "user",
      now: this.now(),
    });
    return { leftover: this.get(l.id), created: true };
  }

  /** Used, gone, or open again; idempotent. */
  setStatus(id: string, status: LeftoverStatus): LeftoverView {
    const l = this.leftover(id);
    if (l.status === status) return this.get(id);
    this.repos.leftovers.setStatus(id, status, this.now());
    return this.get(id);
  }

  /**
   * A pack remainder the planning agent noted (`note_leftover`), from a round or an interactive
   * session. One noted for a suggestion (`position`) waits until a planned meal of it is logged
   * (cooked) before it is on the list. The same description noted again for the same round and
   * suggestion replaces its amounts (a retried run notes it again), else a new `pack` leftover.
   */
  note(n: NoteLeftover, roundId: string | null): { leftover: Leftover; replaced: boolean } {
    if (n.foodId && !this.repos.foods.get(n.foodId)) throw new HttpError(400, `foodId: no food ${n.foodId}`);
    let suggestionId: string | null = null;
    if (n.position !== undefined) {
      if (!roundId) throw new HttpError(400, "position: only with a roundId");
      const s = this.repos.planningRounds.suggestionAt(roundId, n.position);
      if (!s) throw new HttpError(400, `position: the outline has no idea ${n.position}`);
      suggestionId = s.id;
    }
    const now = this.now();
    const same = roundId
      ? this.repos.leftovers
          .ofRound(roundId)
          .find((l) => l.suggestionId === suggestionId && fold(l.description) === fold(n.description))
      : undefined;
    const amounts = {
      foodId: n.foodId ?? null,
      quantity: n.quantity || null,
      grams: n.grams ?? null,
      note: n.note || null,
    };
    if (same) {
      return { leftover: this.repos.leftovers.replaceAmounts(same.id, amounts, now)!, replaced: true };
    }
    const leftover = this.repos.leftovers.insert({
      description: n.description,
      ...amounts,
      source: "pack",
      roundId,
      suggestionId,
      now,
    });
    return { leftover, replaced: false };
  }

  /** Views of leftovers, in two passes: the planned meals eating the cooked ones, recipes and foods. */
  views(leftovers: readonly Leftover[]): LeftoverView[] {
    const foods = this.repos.foods.getMany(leftovers.flatMap((l) => (l.foodId ? [l.foodId] : [])));
    const recipeIds = leftovers.flatMap((l) => (l.recipeId ? [l.recipeId] : []));
    const recipes = this.repos.recipes.getMany(recipeIds);
    const items = this.repos.recipes.itemsOf(recipeIds);
    return leftovers.map((l) => {
      const food = l.foodId ? foods.get(l.foodId) : undefined;
      const recipe = l.recipeId ? recipes.get(l.recipeId) : undefined;
      const eating =
        l.source === "cooked" && l.plannedMealId
          ? this.repos.plannedMeals.leftoversOf(l.plannedMealId).filter((p) => p.status === "planned")
          : [];
      const planned = eating.reduce((sum, p) => sum + p.portionEaten, 0);
      return {
        ...l,
        food: food ? { id: food.id, name: food.name } : null,
        available:
          l.source === "cooked" && l.portions !== null ? Math.max(0, round2(l.portions - planned)) : null,
        plannedFor: eating.map((p) => ({
          plannedMealId: p.id,
          date: p.date,
          slot: p.slot,
          portionEaten: p.portionEaten,
        })),
        perPortion: recipe
          ? nutrientTotals(recipeTotals(portionItems(recipe, items.get(recipe.id) ?? [], 1)))
          : null,
      };
    });
  }

  private leftover(id: string): Leftover {
    const l = this.repos.leftovers.get(id);
    if (!l) throw new HttpError(404, "leftover not found");
    return l;
  }
}

/** The slots a leftover is offered for, in this order. */
const OFFER_SLOTS: readonly MealSlot[] = ["lunch", "dinner"];

/**
 * Where the plan offers each open cooked leftover with portions not planned yet (#49): the first
 * of `days` from the day after it was cooked on (today at the earliest) with lunch open, else
 * dinner; one leftover per slot, the oldest first. A leftover with no such day among `days` isn't
 * offered there (the leftovers list still has it). Pure over the plan's days.
 */
export function leftoverOffers(
  leftovers: readonly LeftoverView[],
  days: readonly Pick<PlanDay, "date" | "openSlots">[],
  today: string,
): Map<string, LeftoverOffer[]> {
  const out = new Map<string, LeftoverOffer[]>();
  const taken = new Set<string>();
  for (const l of leftovers) {
    if (l.source !== "cooked" || l.status !== "open" || (l.available ?? 0) < PORTION_EPSILON) continue;
    const from = l.cookedOn ? addDays(l.cookedOn, 1) : today;
    const start = from < today ? today : from;
    found: for (const d of days) {
      if (d.date < start) continue;
      for (const slot of OFFER_SLOTS) {
        const key = `${d.date}/${slot}`;
        if (!d.openSlots.includes(slot) || taken.has(key)) continue;
        taken.add(key);
        out.set(d.date, [...(out.get(d.date) ?? []), { leftoverId: l.id, slot }]);
        break found;
      }
    }
  }
  return out;
}
