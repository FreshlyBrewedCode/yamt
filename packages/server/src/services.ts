import type { Db } from "./db/index.ts";
import { createRepos, type Repos } from "./db/repos/index.ts";
import { MealService } from "./domain/meals.ts";
import { MediaStore } from "./media/store.ts";

/** The app's domain services over one database and data dir. HTTP (and later MCP) only talk to these. */
export interface Services {
  dataDir: string;
  repos: Repos;
  media: MediaStore;
  meals: MealService;
}

export interface ServicesOptions {
  dataDir: string;
  db: Db;
  /** Seam for tests: the HEIC → JPEG conversion. */
  heicToJpeg?: (heic: Uint8Array) => Promise<Uint8Array>;
}

export function createServices(opts: ServicesOptions): Services {
  const repos = createRepos(opts.db);
  const media = new MediaStore(opts.dataDir);
  return { dataDir: opts.dataDir, repos, media, meals: new MealService(repos, media, opts.heicToJpeg) };
}
