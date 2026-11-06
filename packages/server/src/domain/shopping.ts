import {
  type AddShoppingLineBody,
  AISLES,
  type Aisle,
  addDays,
  type Leftover,
  MAX_PLAN_DAYS,
  type PlannedMeal,
  type Recipe,
  type RecipeItem,
  type ShoppingAtHome,
  type ShoppingCheckBody,
  type ShoppingLine,
  type ShoppingListResponse,
  type ShoppingNeed,
  type ShoppingQuery,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import type { ShoppingItem } from "../db/repos/shopping.ts";
import { aisleByKeyword, aisleOf, fold } from "../nutrition/aisles.ts";
import { HttpError } from "./errors.ts";
import { requestZone } from "./goals.ts";
import { nameWords, sameThing } from "./leftovers.ts";
import { localDate } from "./time.ts";

/** Units that may follow an amount at the start of a description ("1 Dose", "2 EL"). */
const UNITS = new Set(
  (
    "g kg mg ml l cl el tl msp prise prisen dose dosen bund stück stueck stk zehe zehen packung packungen pck pk " +
    "becher glas gläser handvoll scheibe scheiben tasse tassen cup cups tbsp tsp can cans kopf knolle knollen " +
    "stange stangen zweig zweige beutel würfel"
  ).split(" "),
);
const AMOUNT = /^[\d½¼¾⅓⅔⅛.,/\-–x×]+$/;
const AMOUNT_WITH_UNIT = /^\d+(?:[.,]\d+)?(?:g|kg|ml|l)$/;

/**
 * An ingredient as a shopping line names it: the recipe's description without amounts in
 * parentheses ("(ca. 500 g)", not "(Dose)"), what follows a comma ("…, abgetropft") and the
 * leading amount and its unit ("½", "1 Dose", "2 EL", "ca. 200 g"). Never empty.
 */
export function ingredientName(description: string): string {
  const s = description.replace(/\([^)]*\d[^)]*\)/g, " ").split(",")[0] ?? "";
  const tokens = s.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  let amount = false;
  while (i < tokens.length - 1) {
    const t = tokens[i]!.toLowerCase().replace(/\.$/, "");
    const isAmount = AMOUNT.test(t) || AMOUNT_WITH_UNIT.test(t);
    const about = t === "ca" || t === "etwa" || t === "circa";
    if (!isAmount && !about && !(amount && UNITS.has(t))) break;
    if (isAmount) amount = true;
    i++;
  }
  return tokens.slice(i).join(" ") || description.trim();
}

/** The line key of a recipe item: its food, else the words of its name. */
export function lineKey(item: Pick<RecipeItem, "foodId" | "description">): string {
  if (item.foodId) return `food:${item.foodId}`;
  const words = nameWords(ingredientName(item.description));
  return `name:${words.length ? words.join(" ") : fold(item.description)}`;
}

export interface ShoppingInput {
  /** The planned meals the list is for: still `planned`, cooked (not leftover ones). */
  planned: readonly PlannedMeal[];
  recipes: ReadonlyMap<string, { recipe: Recipe; items: readonly RecipeItem[] }>;
  /** What the aisles read off the foods. */
  foods: ReadonlyMap<string, { name: string; categories: readonly string[] }>;
  /** The open leftovers that can stand in for an ingredient (packs and the user's). */
  leftovers: readonly Leftover[];
  /** The checks and own lines that apply to the range. */
  items: readonly ShoppingItem[];
}

/** Whole grams, never 0 for something that is needed. */
const wholeGrams = (g: number) => (g > 0 ? Math.max(1, Math.round(g)) : 0);

/**
 * The shopping list's lines (pure): every item of the planned meals for the portions cooked
 * (grams ÷ servings × portions cooked), summed by line key; each open leftover matched to the
 * first line (by grams) of the same food (its food id, else the same words) and subtracted (one
 * without grams covers the line); a line is checked by a check of its key made at no fewer grams
 * than it needs now; the user's own lines (aisle by keyword). Ordered by aisle, then the lines to
 * buy by grams, the own lines, the covered ones.
 */
export function shoppingLines(input: ShoppingInput): ShoppingLine[] {
  const acc = new Map<
    string,
    {
      key: string;
      name: string;
      foodId: string | null;
      description: string;
      sum: number;
      needs: ShoppingNeed[];
    }
  >();
  for (const p of input.planned) {
    const data = input.recipes.get(p.recipeId);
    if (!data) continue;
    for (const item of data.items) {
      const grams = (item.grams * p.portionsCooked) / data.recipe.servings;
      const key = lineKey(item);
      const line = acc.get(key) ?? {
        key,
        name: ingredientName(item.description),
        foodId: item.foodId,
        description: item.description,
        sum: 0,
        needs: [],
      };
      line.sum += grams;
      const need = line.needs.find((n) => n.plannedMealId === p.id);
      if (need) need.grams += grams;
      else line.needs.push({ plannedMealId: p.id, title: p.title, date: p.date, slot: p.slot, grams });
      acc.set(key, line);
    }
  }
  const computed = [...acc.values()].sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));

  const atHome = new Map<string, Leftover[]>();
  for (const l of input.leftovers) {
    const food = (id: string | null) => (id ? input.foods.get(id)?.name : undefined);
    const match = computed.find(
      (line) =>
        (l.foodId !== null && l.foodId === line.foodId) ||
        sameThing(l.description, line.name) ||
        (food(line.foodId) !== undefined && sameThing(l.description, food(line.foodId)!)),
    );
    if (match) atHome.set(match.key, [...(atHome.get(match.key) ?? []), l]);
  }

  const checks = input.items.filter((i) => i.kind === "check");
  const lines: ShoppingLine[] = computed.map((c) => {
    const home: ShoppingAtHome[] = (atHome.get(c.key) ?? []).map((l) => ({
      leftoverId: l.id,
      description: l.description,
      quantity: l.quantity,
      grams: l.grams,
    }));
    const needed = wholeGrams(c.sum);
    const left = needed - home.reduce((sum, h) => sum + (h.grams ?? 0), 0);
    const covered = home.some((h) => h.grams === null) || left < 0.5;
    const grams = covered ? 0 : wholeGrams(left);
    const food = c.foodId ? (input.foods.get(c.foodId) ?? null) : null;
    return {
      key: c.key,
      name: c.name,
      aisle: aisleOf(food, c.description),
      needed,
      grams,
      atHome: home,
      covered,
      checked:
        !covered && checks.some((k) => k.lineKey === c.key && (k.grams === null || k.grams >= grams - 0.5)),
      own: false,
      needs: c.needs
        .map((n) => ({ ...n, grams: wholeGrams(n.grams) }))
        .sort((a, b) => a.date.localeCompare(b.date) || b.grams - a.grams),
    };
  });
  for (const i of input.items) {
    if (i.kind !== "line" || !i.text) continue;
    lines.push({
      key: `line:${i.id}`,
      name: i.text,
      aisle: aisleByKeyword(i.text) ?? "other",
      needed: null,
      grams: null,
      atHome: [],
      covered: false,
      checked: i.checked,
      own: true,
      needs: [],
    });
  }
  const rank = (l: ShoppingLine) => (l.covered ? 2 : l.own ? 1 : 0);
  const aisle = (a: Aisle) => AISLES.indexOf(a);
  // stable: within a rank the order above (grams, then oldest own line first)
  return lines.sort((a, b) => aisle(a.aisle) - aisle(b.aisle) || rank(a) - rank(b));
}

/**
 * The shopping list (#49): for a range of the plan's days, the lines code computes from the planned
 * meals still `planned` there, minus the leftovers at home, with the checks and own lines the user
 * made for an overlapping range. Online only: every write answers the list again.
 */
export class ShoppingService {
  constructor(
    private readonly repos: Repos,
    /** The server's zone: the default for "today". */
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
  ) {}

  list(q: ShoppingQuery): ShoppingListResponse {
    const timeZone = requestZone(q.tz, this.timeZone);
    const today = localDate(this.now(), timeZone);
    const from = q.from ?? today;
    const last = this.repos.plannedMeals.lastPlannedDate(from);
    const to = q.to ?? (last && last > from ? minDate(last, addDays(from, MAX_PLAN_DAYS - 1)) : from);
    checkRange(from, to);

    const planned = this.repos.plannedMeals
      .between(from, to)
      .filter((p) => p.status === "planned" && p.leftoverOf === null && p.portionsCooked > 0);
    const recipeIds = planned.map((p) => p.recipeId);
    const recipes = this.repos.recipes.getMany(recipeIds);
    const items = this.repos.recipes.itemsOf(recipeIds);
    const byRecipe = new Map(
      [...recipes].map(([id, recipe]) => [id, { recipe, items: items.get(id) ?? [] }] as const),
    );
    const foodIds = [...items.values()].flat().flatMap((i) => (i.foodId ? [i.foodId] : []));
    const leftovers = this.repos.leftovers.listOpen().filter((l) => l.source !== "cooked");
    const lines = shoppingLines({
      planned,
      recipes: byRecipe,
      foods: this.repos.foods.aisleData([
        ...foodIds,
        ...leftovers.flatMap((l) => (l.foodId ? [l.foodId] : [])),
      ]),
      leftovers,
      items: this.repos.shoppingItems.overlapping(from, to),
    });
    const toBuy = lines.filter((l) => !l.covered);
    return {
      from,
      to,
      timeZone,
      today,
      lastPlannedDay: this.repos.plannedMeals.lastPlannedDate(today),
      meals: planned.length,
      lines,
      toBuy: toBuy.length,
      inBasket: toBuy.filter((l) => l.checked).length,
    };
  }

  /**
   * A line into the basket or out of it. A computed line's check keeps the grams it has now (if
   * the plan later needs more, the line is open again); unchecking removes every check of it that
   * applies to the range. Idempotent.
   */
  check(body: ShoppingCheckBody, tz?: string): ShoppingListResponse {
    checkRange(body.from, body.to);
    const now = this.now();
    if (body.key.startsWith("line:")) {
      const id = body.key.slice("line:".length);
      if (this.repos.shoppingItems.get(id)?.kind !== "line") throw new HttpError(404, "no such line");
      this.repos.shoppingItems.setLineChecked(id, body.checked, now);
    } else {
      const list = this.list({ from: body.from, to: body.to, tz });
      const line = list.lines.find((l) => l.key === body.key);
      if (!line) throw new HttpError(409, "the line isn't on the list for these days any more");
      this.repos.db.transaction(() => {
        this.repos.shoppingItems.uncheck(body.key, body.from, body.to);
        if (body.checked) this.repos.shoppingItems.check(body.key, line.grams, body.from, body.to, now);
      })();
    }
    return this.list({ from: body.from, to: body.to, tz });
  }

  /** A line of the user's own, for the range. Idempotent with a client `id`. */
  addLine(body: AddShoppingLineBody, tz?: string): { list: ShoppingListResponse; created: boolean } {
    checkRange(body.from, body.to);
    const existing = body.id ? this.repos.shoppingItems.get(body.id) : null;
    if (existing && (existing.kind !== "line" || existing.text !== body.text)) {
      throw new HttpError(409, "id: another shopping line has this id");
    }
    if (!existing) {
      this.repos.shoppingItems.addLine({
        id: body.id,
        text: body.text,
        from: body.from,
        to: body.to,
        now: this.now(),
      });
    }
    return { list: this.list({ from: body.from, to: body.to, tz }), created: !existing };
  }

  /** One of the user's own lines removed (404 when there is none). */
  removeLine(id: string): void {
    if (this.repos.shoppingItems.get(id)?.kind !== "line") throw new HttpError(404, "no such line");
    this.repos.shoppingItems.delete(id);
  }
}

const minDate = (a: string, b: string) => (a < b ? a : b);

function checkRange(from: string, to: string): void {
  if (to < from) throw new HttpError(400, "to: lies before from");
  if (to > addDays(from, MAX_PLAN_DAYS - 1))
    throw new HttpError(400, `to: at most ${MAX_PLAN_DAYS} days at a time`);
}
