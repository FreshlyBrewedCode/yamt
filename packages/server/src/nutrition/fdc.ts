import { type Fetch, getJson, RateLimiter, UpstreamError } from "./http.ts";
import { type FoodData, mapFdcFood } from "./nutrients.ts";

/** Generic foods only: branded entries are Open Food Facts' job (and better there for Germany). */
export const FDC_DATA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

const BASE = "https://api.nal.usda.gov/fdc/v1";

export const FDC_URLS = {
  search: (query: string, limit: number, apiKey: string) => {
    const q = new URLSearchParams({
      query,
      dataType: FDC_DATA_TYPES.join(","),
      pageSize: String(limit),
      api_key: apiKey,
    });
    return `${BASE}/foods/search?${q}`;
  },
  food: (fdcId: string, apiKey: string) =>
    `${BASE}/food/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(apiKey)}`,
};

export interface FdcFood extends FoodData {
  fdcId: string;
  dataType: string | null;
  raw: Record<string, unknown>;
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * USDA FoodData Central: search (Foundation, SR Legacy, Survey) and details by id. Needs an API
 * key (`FDC_API_KEY` or `fdcApiKey` in config.json); without one `available` is false and the
 * search reports FDC as unavailable. The key allows 1000 requests an hour.
 */
export class FdcClient {
  private readonly limiter = new RateLimiter(10, 3_600);

  constructor(
    private readonly fetchFn: Fetch,
    private readonly apiKey: string | null,
  ) {}

  get available(): boolean {
    return this.apiKey !== null;
  }

  async search(query: string, limit: number): Promise<FdcFood[]> {
    const body = (await getJson(this.fetchFn, FDC_URLS.search(query, limit, this.key()), this.opts())) as {
      foods?: Record<string, unknown>[];
    };
    return (body.foods ?? []).filter((f) => f.fdcId !== undefined).map(toFood);
  }

  /** Null when FDC has no food with this id. */
  async food(fdcId: string): Promise<FdcFood | null> {
    try {
      return toFood(
        (await getJson(this.fetchFn, FDC_URLS.food(fdcId, this.key()), this.opts())) as Record<
          string,
          unknown
        >,
      );
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
  }

  private key(): string {
    if (!this.apiKey) throw new UpstreamError("FDC is not configured: set FDC_API_KEY");
    return this.apiKey;
  }

  private opts() {
    return { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, limiter: this.limiter };
  }
}

function toFood(raw: Record<string, unknown>): FdcFood {
  return {
    ...mapFdcFood(raw),
    fdcId: String(raw.fdcId),
    dataType: typeof raw.dataType === "string" ? raw.dataType : null,
    raw,
  };
}
