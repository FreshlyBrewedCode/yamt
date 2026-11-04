import { type Fetch, getJson, RateLimiter, UpstreamError } from "./http.ts";
import { type FoodData, mapOffProduct } from "./nutrients.ts";

/** The product fields yamt asks for: enough to map and keep, far less than a full product. */
export const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_de",
  "product_name_en",
  "generic_name",
  "generic_name_de",
  "brands",
  "quantity",
  "serving_size",
  "serving_quantity",
  "serving_quantity_unit",
  "nutriments",
  "nutrition_data_per",
  "countries_tags",
].join(",");

export const OFF_URLS = {
  product: (barcode: string) =>
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=${OFF_FIELDS}`,
  /** search-a-licious (Elasticsearch): full text, German names first, products sold in Germany. */
  search: (query: string, limit: number) => {
    const q = new URLSearchParams({
      q: `${query} countries_tags:"en:germany"`,
      langs: "de,en",
      page_size: String(limit),
      fields: OFF_FIELDS,
    });
    return `https://search.openfoodfacts.org/search?${q}`;
  },
  /** The classic search, used when search-a-licious fails. */
  legacySearch: (query: string, limit: number) => {
    const q = new URLSearchParams({
      search_terms: query,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: String(limit),
      cc: "de",
      lc: "de",
      fields: OFF_FIELDS,
    });
    return `https://world.openfoodfacts.org/cgi/search.pl?${q}`;
  },
};

export interface OffProduct extends FoodData {
  barcode: string;
  raw: Record<string, unknown>;
}

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Open Food Facts: products by barcode and text search, biased to German products. OFF's limits
 * are 100 product reads and 10 searches per minute; the buckets stay below them.
 */
export class OffClient {
  private readonly productLimiter = new RateLimiter(10, 1_000);
  private readonly searchLimiter = new RateLimiter(5, 6_000);

  constructor(private readonly fetchFn: Fetch) {}

  /** Null when OFF doesn't know the barcode. */
  async product(barcode: string): Promise<OffProduct | null> {
    let body: Record<string, unknown>;
    try {
      body = (await getJson(
        this.fetchFn,
        OFF_URLS.product(barcode),
        this.opts(this.productLimiter),
      )) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
    const product = body.product as Record<string, unknown> | undefined;
    if (body.status === 0 || !product) return null;
    return toProduct({ code: barcode, ...product });
  }

  async search(query: string, limit: number): Promise<OffProduct[]> {
    let hits: Record<string, unknown>[];
    try {
      const body = (await getJson(
        this.fetchFn,
        OFF_URLS.search(query, limit),
        this.opts(this.searchLimiter),
      )) as {
        hits?: Record<string, unknown>[];
      };
      hits = body.hits ?? [];
    } catch (first) {
      try {
        const body = (await getJson(
          this.fetchFn,
          OFF_URLS.legacySearch(query, limit),
          this.opts(this.searchLimiter),
        )) as { products?: Record<string, unknown>[] };
        hits = body.products ?? [];
      } catch {
        throw first;
      }
    }
    return hits.filter((h) => typeof h.code === "string" && h.code).map(toProduct);
  }

  private opts(limiter: RateLimiter) {
    return { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, limiter };
  }
}

function toProduct(raw: Record<string, unknown>): OffProduct {
  return { ...mapOffProduct(raw), barcode: String(raw.code), raw };
}
