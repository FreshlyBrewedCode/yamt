import { CORE_NUTRIENTS, type CoreNutrient, type Nutrients, type NutrientValue } from "@yamt/shared";

/** A food as a source describes it, before it is cached as a `foods` row. */
export interface FoodData {
  name: string;
  brand: string | null;
  per100g: Nutrients;
  nutrients: Record<string, NutrientValue>;
  portions: { label: string; grams: number }[];
}

export const emptyNutrients = (): Nutrients =>
  Object.fromEntries(CORE_NUTRIENTS.map((k) => [k, null])) as Nutrients;

/** Salt from sodium (EU labelling: salt = sodium × 2.5). */
export const SALT_PER_SODIUM = 2.5;
const KJ_PER_KCAL = 4.184;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

const round = (n: number, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * yamt's `carbohydrate` is *available* carbohydrate, excluding fiber, as on EU labels (Regulation
 * 1169/2011: "Kohlenhydrate", fiber listed separately). Sources that report a total including
 * fiber (USDA, US/Canadian labels) get the fiber taken off, never below 0. Without a fiber value
 * the total is kept as it is: fiber stays null, so totals report fiber as missing, and such foods
 * (meat, dairy, oils, drinks) mostly have little or none.
 */
const availableCarbohydrate = (total: number | null, fiber: number | null): number | null =>
  total === null || fiber === null ? total : round(Math.max(0, total - fiber));

// ---- Open Food Facts --------------------------------------------------------------------------

/** OFF `nutriments` keys (per 100 g) for the core set. */
const OFF_KEYS: Record<CoreNutrient, string> = {
  energyKcal: "energy-kcal_100g",
  protein: "proteins_100g",
  fat: "fat_100g",
  saturatedFat: "saturated-fat_100g",
  carbohydrate: "carbohydrates_100g",
  sugars: "sugars_100g",
  fiber: "fiber_100g",
  salt: "salt_100g",
};

/** Units OFF uses for `<name>_100g` when `<name>_unit` is missing. */
const offUnit = (nutriments: Record<string, unknown>, name: string): string => {
  const u = nutriments[`${name}_unit`];
  if (typeof u === "string" && u) return u;
  if (name === "energy-kcal") return "kcal";
  if (name === "energy" || name === "energy-kj") return "kJ";
  return "g";
};

/** An OFF product (v2 product, search-a-licious hit or cgi search) → the core set and full profile. */
export function mapOffProduct(p: Record<string, unknown>): FoodData {
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const per100g = emptyNutrients();
  for (const k of CORE_NUTRIENTS) per100g[k] = num(n[OFF_KEYS[k]]);
  // energy is sometimes only given in kJ, salt only as sodium
  if (per100g.energyKcal === null) {
    const kj = num(n["energy-kj_100g"]) ?? num(n.energy_100g);
    if (kj !== null) per100g.energyKcal = round(kj / KJ_PER_KCAL, 1);
  }
  if (per100g.salt === null) {
    const sodium = num(n.sodium_100g);
    if (sodium !== null) per100g.salt = round(sodium * SALT_PER_SODIUM);
  }
  // `carbohydrates` is the EU field (available, fiber excluded); since 2025 US/Canadian labels'
  // "Total carbohydrate" goes into `carbohydrates-total` (fiber included). Older non-EU entries
  // may still hold a total in `carbohydrates`; nothing marks those, so they pass through as is.
  if (per100g.carbohydrate === null) {
    per100g.carbohydrate = availableCarbohydrate(num(n["carbohydrates-total_100g"]), per100g.fiber);
  }

  const nutrients: Record<string, NutrientValue> = {};
  for (const [key, value] of Object.entries(n)) {
    if (!key.endsWith("_100g")) continue;
    const v = num(value);
    if (v === null) continue;
    const name = key.slice(0, -"_100g".length);
    nutrients[name] = { value: v, unit: offUnit(n, name) };
  }

  const portions: FoodData["portions"] = [];
  const servingG = num(p.serving_quantity);
  const unit = typeof p.serving_quantity_unit === "string" ? p.serving_quantity_unit : "g";
  if (servingG !== null && servingG > 0 && (unit === "g" || unit === "ml")) {
    const label =
      typeof p.serving_size === "string" && p.serving_size.trim() ? p.serving_size.trim() : "1 serving";
    portions.push({ label, grams: servingG });
  }

  return { name: offName(p), brand: offBrand(p.brands), per100g, nutrients, portions };
}

function offName(p: Record<string, unknown>): string {
  for (const k of ["product_name_de", "product_name", "generic_name_de", "generic_name", "product_name_en"]) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return typeof p.code === "string" ? `Product ${p.code}` : "Unnamed product";
}

/** `brands` is a comma-separated string (product, cgi search) or a list (search-a-licious). */
function offBrand(brands: unknown): string | null {
  const list = Array.isArray(brands) ? brands : typeof brands === "string" ? brands.split(",") : [];
  const first = list.map((b) => (typeof b === "string" ? b.trim() : "")).find(Boolean);
  return first ?? null;
}

// ---- USDA FoodData Central --------------------------------------------------------------------

/**
 * FDC nutrient ids for the core set, in order of preference. Foundation foods often lack 1008
 * (Energy) and 1004 (Total lipid), reporting Atwater energy (2048 specific, 2047 general) and
 * "Total fat (NLEA)" (1085) instead. Nutrient numbers (the older "208"-style codes, used by the
 * abridged format) are the fallback key. Both carbohydrate values include fiber: 1005 "by
 * difference" (100 − water, protein, fat, ash, alcohol) and 1050 "by summation" (sugars + starch +
 * fiber); `mapFdcFood` subtracts fiber (1079) to get available carbohydrate.
 */
const FDC_IDS: Record<CoreNutrient, { id: number; number: string }[]> = {
  energyKcal: [
    { id: 1008, number: "208" },
    { id: 2048, number: "958" },
    { id: 2047, number: "957" },
  ],
  protein: [{ id: 1003, number: "203" }],
  fat: [
    { id: 1004, number: "204" },
    { id: 1085, number: "298" },
  ],
  saturatedFat: [{ id: 1258, number: "606" }],
  carbohydrate: [
    { id: 1005, number: "205" },
    { id: 1050, number: "205.2" },
  ],
  sugars: [
    { id: 2000, number: "269" },
    { id: 1063, number: "269.3" },
  ],
  fiber: [{ id: 1079, number: "291" }],
  // sodium in mg → salt in g
  salt: [{ id: 1093, number: "307" }],
};
const FDC_ENERGY_KJ = { id: 1062, number: "268" };

interface FdcNutrient {
  id: number | null;
  number: string | null;
  name: string;
  unit: string;
  value: number;
}

/**
 * The three shapes FDC reports nutrients in: search hits (`nutrientId`, `value`), full details
 * (`nutrient: {id, number, name, unitName}`, `amount`) and abridged details (`number`, `amount`).
 */
function fdcNutrients(food: Record<string, unknown>): FdcNutrient[] {
  const list = Array.isArray(food.foodNutrients) ? (food.foodNutrients as Record<string, unknown>[]) : [];
  const out: FdcNutrient[] = [];
  for (const fn of list) {
    const nested = (fn.nutrient ?? null) as Record<string, unknown> | null;
    const value = num(fn.amount ?? fn.value);
    if (value === null) continue;
    const id = num(nested?.id ?? fn.nutrientId);
    const number = nested?.number ?? fn.nutrientNumber ?? fn.number;
    const name = nested?.name ?? fn.nutrientName ?? fn.name;
    const unit = nested?.unitName ?? fn.unitName;
    out.push({
      id,
      number: typeof number === "string" ? number : null,
      name: typeof name === "string" ? name : `nutrient ${id ?? number}`,
      unit: typeof unit === "string" ? unit.toLowerCase() : "",
      value,
    });
  }
  return out;
}

const findFdc = (list: FdcNutrient[], key: { id: number; number: string }) =>
  list.find((n) => n.id === key.id) ?? list.find((n) => n.id === null && n.number === key.number);

/** Mass units FDC uses, in grams. */
const GRAMS: Record<string, number> = { g: 1, mg: 0.001, ug: 0.000001, µg: 0.000001 };

/** An FDC food (search hit or details, Foundation / SR Legacy / Survey) → core set and profile. */
export function mapFdcFood(food: Record<string, unknown>): FoodData {
  const list = fdcNutrients(food);
  const per100g = emptyNutrients();
  for (const k of CORE_NUTRIENTS) {
    for (const key of FDC_IDS[k]) {
      const n = findFdc(list, key);
      if (!n) continue;
      if (k === "energyKcal") {
        if (n.unit !== "kcal") continue;
        per100g[k] = n.value;
      } else if (k === "salt") {
        const g = GRAMS[n.unit];
        if (g !== undefined) per100g[k] = round(n.value * g * SALT_PER_SODIUM);
      } else {
        const g = GRAMS[n.unit];
        if (g !== undefined) per100g[k] = round(n.value * g);
      }
      if (per100g[k] !== null) break;
    }
  }
  if (per100g.energyKcal === null) {
    const kj = findFdc(list, FDC_ENERGY_KJ);
    if (kj) per100g.energyKcal = round(kj.value / KJ_PER_KCAL, 1);
  }
  per100g.carbohydrate = availableCarbohydrate(per100g.carbohydrate, per100g.fiber);

  const nutrients: Record<string, NutrientValue> = {};
  for (const n of list) {
    // FDC lists energy in kcal and kJ under the same name
    const name = n.name === "Energy" ? `Energy (${n.unit})` : n.name;
    if (!(name in nutrients)) nutrients[name] = { value: n.value, unit: n.unit };
  }

  return {
    name: typeof food.description === "string" ? food.description : `FDC ${food.fdcId}`,
    brand: typeof food.brandOwner === "string" ? food.brandOwner : null,
    per100g,
    nutrients,
    portions: fdcPortions(food),
  };
}

/** `foodPortions` (details) or `foodMeasures` (search hits) → labelled gram weights. */
function fdcPortions(food: Record<string, unknown>): FoodData["portions"] {
  const out: FoodData["portions"] = [];
  const add = (label: string, grams: number | null) => {
    if (!label || grams === null || grams <= 0 || out.some((p) => p.label === label)) return;
    out.push({ label, grams: round(grams, 1) });
  };
  for (const p of (Array.isArray(food.foodPortions) ? food.foodPortions : []) as Record<string, unknown>[]) {
    const amount = num(p.amount) ?? 1;
    const unit = (p.measureUnit as Record<string, unknown> | undefined)?.name;
    const what =
      (typeof p.portionDescription === "string" && p.portionDescription !== "Quantity not specified"
        ? p.portionDescription
        : null) ??
      [typeof p.modifier === "string" ? p.modifier : null, unit && unit !== "undetermined" ? unit : null]
        .filter(Boolean)
        .join(" ");
    add(/^\d/.test(what) ? what : `${amount} ${what}`.trim(), num(p.gramWeight));
  }
  for (const m of (Array.isArray(food.foodMeasures) ? food.foodMeasures : []) as Record<string, unknown>[]) {
    const label = typeof m.disseminationText === "string" ? m.disseminationText : "";
    if (label !== "Quantity not specified") add(label, num(m.gramWeight));
  }
  return out.slice(0, 12);
}
