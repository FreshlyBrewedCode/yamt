import { dataPaths } from "./config.ts";
import type { Db } from "./db/index.ts";
import { createRepos, type Repos } from "./db/repos/index.ts";
import { FoodService } from "./domain/foods.ts";
import { MealService } from "./domain/meals.ts";
import { RevisionService } from "./domain/revisions.ts";
import { localTimeZone } from "./domain/time.ts";
import { McpTokens } from "./mcp/tokens.ts";
import { MediaStore } from "./media/store.ts";
import { FdcClient } from "./nutrition/fdc.ts";
import type { Fetch } from "./nutrition/http.ts";
import { OffClient } from "./nutrition/off.ts";

/** The app's domain services over one database and data dir. HTTP and MCP only talk to these. */
export interface Services {
  dataDir: string;
  repos: Repos;
  media: MediaStore;
  meals: MealService;
  foods: FoodService;
  revisions: RevisionService;
  /** Bearer tokens for /mcp: the interactive one and per-run ones (#8 mints and revokes). */
  mcpTokens: McpTokens;
  /** Outbound fetch (food databases, recipe pages); a fixture-backed fake in tests. */
  fetch: Fetch;
  /** Days and local times are reckoned in this zone (the server's). */
  timeZone: string;
}

export interface ServicesOptions {
  dataDir: string;
  db: Db;
  /** Seam for tests: the HEIC → JPEG conversion. */
  heicToJpeg?: (heic: Uint8Array) => Promise<Uint8Array>;
  /** Null or absent: FDC is unavailable. */
  fdcApiKey?: string | null;
  /** Seam for tests: outbound HTTP. Defaults to the real fetch. */
  fetch?: Fetch;
  timeZone?: string;
}

export function createServices(opts: ServicesOptions): Services {
  const repos = createRepos(opts.db);
  const media = new MediaStore(opts.dataDir);
  const fetchFn: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const revisions = new RevisionService(repos);
  return {
    dataDir: opts.dataDir,
    repos,
    media,
    meals: new MealService(repos, media, revisions, opts.heicToJpeg),
    foods: new FoodService(repos, new OffClient(fetchFn), new FdcClient(fetchFn, opts.fdcApiKey ?? null)),
    revisions,
    mcpTokens: new McpTokens(dataPaths(opts.dataDir).mcpToken),
    fetch: fetchFn,
    timeZone: opts.timeZone ?? localTimeZone(),
  };
}
