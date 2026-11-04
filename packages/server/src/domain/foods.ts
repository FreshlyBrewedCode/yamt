import type { Food, FoodSource, Nutrients, NutrientValue, Portion } from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import type { FdcClient } from "../nutrition/fdc.ts";
import { emptyNutrients, type FoodData } from "../nutrition/nutrients.ts";
import type { OffClient } from "../nutrition/off.ts";
import { type CandidateOrigin, rankCandidates } from "../nutrition/ranking.ts";
import { HttpError } from "./errors.ts";

/** Cached foods older than this are fetched again when looked up (searches reuse them as they are). */
const STALE_MS = 30 * 24 * 60 * 60_000;
/** Remote search results are remembered this long (OFF allows 10 searches a minute). */
const SEARCH_CACHE_MS = 60 * 60_000;
const SEARCH_CACHE_MAX = 200;

export type SearchSource = CandidateOrigin;

export interface FoodCandidate {
  foodId: string;
  /** Where this candidate was found. */
  origin: CandidateOrigin;
  /** Where the food's numbers come from. */
  source: FoodSource;
  sourceRef: string | null;
  name: string;
  brand: string | null;
  per100g: Nutrients;
  portions: Portion[];
  /** History only: distinct meals it was used in. */
  usedInMeals: number | null;
  score: number;
}

export interface FoodSearchResult {
  candidates: FoodCandidate[];
  /** Sources that could not be asked, and why (no key, timeout, HTTP error). */
  unavailable: { source: SearchSource; reason: string }[];
}

export interface NewFood {
  source: "label" | "custom";
  name: string;
  brand?: string | null;
  /** The barcode, if the package has one (a label food then replaces OFF's for lookups). */
  barcode?: string | null;
  per100g: Partial<Nutrients> & { energyKcal: number };
  /** More of the label per 100 g, e.g. {"monounsaturated fat": {value: 3, unit: "g"}}. */
  nutrients?: Record<string, NutrientValue>;
  portions?: Portion[];
  /** What it was made from: the photo of the label, a note. */
  captureId?: string | null;
  note?: string | null;
}

/**
 * Foods: search (personal history, then Open Food Facts, then USDA FDC), lookups by barcode or
 * id, and foods read off a label or made up. Everything found remotely is cached in `foods`,
 * so every candidate has a food id the agent can put into a revision.
 */
export class FoodService {
  private readonly searchCache = new Map<string, { at: number; ids: string[] }>();

  constructor(
    private readonly repos: Repos,
    private readonly off: OffClient,
    private readonly fdc: FdcClient,
    private readonly now: () => number = Date.now,
  ) {}

  get fdcAvailable(): boolean {
    return this.fdc.available;
  }

  async search(
    query: string,
    opts: { sources?: SearchSource[]; limit?: number } = {},
  ): Promise<FoodSearchResult> {
    const q = query.trim();
    if (!q) throw new HttpError(400, "query: say what to look for");
    const limit = opts.limit ?? 10;
    const sources = new Set(opts.sources ?? ["history", "off", "fdc"]);
    const unavailable: FoodSearchResult["unavailable"] = [];
    type Raw = Omit<FoodCandidate, "score"> & { sourceRank: number; meals?: number };
    const found: Raw[] = [];
    const add = (food: Food, origin: CandidateOrigin, sourceRank: number, meals: number | null): void => {
      found.push({
        foodId: food.id,
        origin,
        source: food.source,
        sourceRef: food.sourceRef,
        name: food.name,
        brand: food.brand,
        per100g: food.per100g,
        portions: food.portions,
        usedInMeals: meals,
        sourceRank,
        ...(meals === null ? {} : { meals }),
      });
    };

    if (sources.has("history")) {
      this.repos.foods.searchHistory(q, limit).forEach((h, i) => {
        add(h.food, "history", i, h.meals);
      });
    }
    const ask = async (origin: "off" | "fdc", run: () => Promise<Food[]>) => {
      try {
        const foods = await this.remoteSearch(origin, q, limit, run);
        foods.forEach((f, i) => {
          add(f, origin, i, null);
        });
      } catch (e) {
        unavailable.push({ source: origin, reason: reason(e) });
      }
    };
    const remote: Promise<void>[] = [];
    if (sources.has("off")) {
      remote.push(
        ask("off", async () =>
          (await this.off.search(q, limit)).map((p) =>
            this.cache("off", p.barcode, p, p.raw, { keepFresh: true }),
          ),
        ),
      );
    }
    if (sources.has("fdc")) {
      if (!this.fdc.available) {
        unavailable.push({ source: "fdc", reason: "no FDC_API_KEY configured" });
      } else {
        remote.push(
          ask("fdc", async () =>
            (await this.fdc.search(q, limit)).map((f) =>
              this.cache("fdc", f.fdcId, f, f.raw, { keepFresh: true }),
            ),
          ),
        );
      }
    }
    await Promise.all(remote);

    // a food found in history and again remotely is listed once, as history
    const seen = new Set<string>();
    const unique = rankCandidates(q, found).filter((c) => {
      if (seen.has(c.foodId)) return false;
      seen.add(c.foodId);
      return true;
    });
    return {
      candidates: unique.slice(0, limit).map(({ sourceRank: _r, meals: _m, ...c }) => c),
      unavailable,
    };
  }

  /**
   * A cached food. `refresh` fetches it again from its source; an FDC food that was only seen in
   * a search is completed with its details (portions) once.
   */
  async get(foodId: string, opts: { refresh?: boolean } = {}): Promise<Food> {
    const food = this.repos.foods.get(foodId);
    if (!food) throw new HttpError(404, `no food with id ${foodId}`);
    if (food.sourceRef === null) return food;
    if (food.source === "off" && opts.refresh) {
      return (await this.barcode(food.sourceRef, { refresh: true })) ?? food;
    }
    if (food.source === "fdc" && this.fdc.available) {
      const raw = this.repos.foods.raw(foodId) as Record<string, unknown> | null;
      if (opts.refresh || !raw || !("foodPortions" in raw)) {
        try {
          const details = await this.fdc.food(food.sourceRef);
          if (details) return this.cache("fdc", details.fdcId, details, details.raw);
        } catch (e) {
          if (opts.refresh) throw upstream("fdc", e);
        }
      }
    }
    return food;
  }

  /**
   * A product by barcode: a food read off this package's label wins (it was made because OFF
   * lacked or misreported it), then the cached OFF product, then OFF itself. Null if unknown.
   */
  async barcode(code: string, opts: { refresh?: boolean } = {}): Promise<Food | null> {
    const barcode = code.replace(/\s+/g, "");
    if (!/^\d{6,14}$/.test(barcode)) throw new HttpError(400, "barcode: 6 to 14 digits (EAN/UPC)");
    const label = this.repos.foods.bySource("label", barcode);
    if (label && !opts.refresh) return label;
    const cached = this.repos.foods.bySource("off", barcode);
    if (cached && !opts.refresh && cached.fetchedAt !== null && this.now() - cached.fetchedAt < STALE_MS) {
      return cached;
    }
    let product: Awaited<ReturnType<OffClient["product"]>>;
    try {
      product = await this.off.product(barcode);
    } catch (e) {
      // OFF down: what we have is better than nothing
      if (cached) return cached;
      throw upstream("off", e);
    }
    if (!product) return cached ?? null;
    return this.cache("off", barcode, product, product.raw);
  }

  /** A food read off a label (provenance `label`) or made up (`custom`). */
  create(f: NewFood): Food {
    if (f.captureId && !this.repos.captures.get(f.captureId)) {
      throw new HttpError(400, `captureId: no capture ${f.captureId}`);
    }
    const per100g = { ...emptyNutrients(), ...f.per100g };
    const data: FoodData = {
      name: f.name.trim(),
      brand: f.brand?.trim() || null,
      per100g,
      nutrients: f.nutrients ?? {},
      portions: f.portions ?? [],
    };
    const barcode = f.barcode?.replace(/\s+/g, "") || null;
    if (barcode !== null && !/^\d{6,14}$/.test(barcode)) {
      throw new HttpError(400, "barcode: 6 to 14 digits (EAN/UPC)");
    }
    return this.repos.foods.save({
      source: f.source,
      sourceRef: barcode,
      data,
      raw: { createdFrom: { captureId: f.captureId ?? null, note: f.note ?? null } },
      fetchedAt: null,
      now: this.now(),
    });
  }

  /** Save a fetched record; `keepFresh` leaves a recently fetched row alone (search hits are thinner). */
  private cache(
    source: "off" | "fdc",
    ref: string,
    data: FoodData,
    raw: unknown,
    opts: { keepFresh?: boolean } = {},
  ): Food {
    const now = this.now();
    if (opts.keepFresh) {
      const existing = this.repos.foods.bySource(source, ref);
      if (existing?.fetchedAt != null && now - existing.fetchedAt < STALE_MS) return existing;
    }
    return this.repos.foods.save({ source, sourceRef: ref, data, raw, fetchedAt: now, now });
  }

  /** Remote search with a short in-memory cache of the food ids it found. */
  private async remoteSearch(
    source: "off" | "fdc",
    query: string,
    limit: number,
    run: () => Promise<Food[]>,
  ): Promise<Food[]> {
    const key = `${source}\u0000${limit}\u0000${query.toLowerCase()}`;
    const hit = this.searchCache.get(key);
    if (hit && this.now() - hit.at < SEARCH_CACHE_MS) {
      const foods = this.repos.foods.getMany(hit.ids);
      return hit.ids.map((id) => foods.get(id)).filter((f): f is Food => f !== undefined);
    }
    const foods = await run();
    if (this.searchCache.size >= SEARCH_CACHE_MAX) {
      const oldest = this.searchCache.keys().next().value;
      if (oldest !== undefined) this.searchCache.delete(oldest);
    }
    this.searchCache.set(key, { at: this.now(), ids: foods.map((f) => f.id) });
    return foods;
  }
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function upstream(source: "off" | "fdc", e: unknown): HttpError {
  const name = source === "off" ? "Open Food Facts" : "FoodData Central";
  return new HttpError(503, `${name} is not reachable right now (${reason(e)})`);
}
