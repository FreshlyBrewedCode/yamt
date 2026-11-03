import { DEFAULT_PUSH_SUBJECT, dataPaths } from "./config.ts";
import type { Db } from "./db/index.ts";
import { createRepos, type Repos } from "./db/repos/index.ts";
import { FoodService } from "./domain/foods.ts";
import { GoalService } from "./domain/goals.ts";
import { MealService } from "./domain/meals.ts";
import { RevisionService } from "./domain/revisions.ts";
import { ShareService } from "./domain/share.ts";
import { localTimeZone } from "./domain/time.ts";
import { McpTokens } from "./mcp/tokens.ts";
import { MediaStore } from "./media/store.ts";
import { FdcClient } from "./nutrition/fdc.ts";
import type { Fetch } from "./nutrition/http.ts";
import { OffClient } from "./nutrition/off.ts";
import { PushSender } from "./push/sender.ts";
import { loadVapidKeys, type VapidKeys } from "./push/vapid.ts";

/** The app's domain services over one database and data dir. HTTP and MCP only talk to these. */
export interface Services {
  dataDir: string;
  repos: Repos;
  media: MediaStore;
  meals: MealService;
  foods: FoodService;
  revisions: RevisionService;
  /** The share target (#26): shared items into the current draft meal, or a new one. */
  share: ShareService;
  /** Daily goals and the day view (#12). */
  goals: GoalService;
  /** Bearer tokens for /mcp: the interactive one and per-run ones (#8 mints and revokes). */
  mcpTokens: McpTokens;
  /** Outbound fetch (food databases, recipe pages); a fixture-backed fake in tests. */
  fetch: Fetch;
  /** Days and local times are reckoned in this zone (the server's). */
  timeZone: string;
  /** Web Push (#13): the VAPID key and delivery to the registered subscriptions. */
  push: PushSender;
  /** Pokes the job worker after an enqueue; the server wires it to its worker (a no-op without one). */
  queue: { wake: () => void };
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
  /** Web Push: the VAPID subject (default: the project URL); seams for tests. */
  push?: {
    subject?: string;
    /** Outbound HTTP to push services; defaults to the real fetch (not `fetch` above). */
    fetch?: Fetch;
    log?: (message: string) => void;
  };
}

export function createServices(opts: ServicesOptions): Services {
  const repos = createRepos(opts.db);
  const media = new MediaStore(opts.dataDir);
  const fetchFn: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const revisions = new RevisionService(repos);
  const queue = { wake: () => {} };
  const meals = new MealService(repos, media, revisions, opts.heicToJpeg, () => queue.wake());
  const timeZone = opts.timeZone ?? localTimeZone();
  let vapid: VapidKeys | null = null;
  const push = new PushSender(repos.pushSubscriptions, {
    keys: () => (vapid ??= loadVapidKeys(dataPaths(opts.dataDir).vapid)),
    subject: opts.push?.subject ?? DEFAULT_PUSH_SUBJECT,
    fetch: opts.push?.fetch ?? ((input, init) => fetch(input, init)),
    log: opts.push?.log,
  });
  return {
    dataDir: opts.dataDir,
    repos,
    media,
    meals,
    foods: new FoodService(repos, new OffClient(fetchFn), new FdcClient(fetchFn, opts.fdcApiKey ?? null)),
    revisions,
    share: new ShareService(repos, meals, timeZone),
    goals: new GoalService(repos, meals, timeZone),
    mcpTokens: new McpTokens(dataPaths(opts.dataDir).mcpToken),
    fetch: fetchFn,
    timeZone,
    push,
    queue,
  };
}
