import type { Db } from "../index.ts";
import { CaptureRepo } from "./captures.ts";
import { JobRepo } from "./jobs.ts";
import { MealRepo } from "./meals.ts";
import { TranscriptRepo } from "./transcripts.ts";
import { WeightRepo } from "./weight.ts";

export type Repos = ReturnType<typeof createRepos>;

/** Every repository over one database. Services and routes use these, never SQL. */
export function createRepos(db: Db) {
  return {
    db,
    meals: new MealRepo(db),
    captures: new CaptureRepo(db),
    transcripts: new TranscriptRepo(db),
    jobs: new JobRepo(db),
    weight: new WeightRepo(db),
  };
}
