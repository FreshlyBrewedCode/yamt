import type { Db } from "../index.ts";
import { CaptureRepo } from "./captures.ts";
import { FoodRepo } from "./foods.ts";
import { GoalRepo } from "./goals.ts";
import { JobRepo } from "./jobs.ts";
import { MealRepo } from "./meals.ts";
import { PlannedMealRepo } from "./planned-meals.ts";
import { ProfileRepo } from "./profile.ts";
import { PushSubscriptionRepo } from "./push.ts";
import { RecipeRepo } from "./recipes.ts";
import { RevisionRepo } from "./revisions.ts";
import { RunRepo } from "./runs.ts";
import { SettingsRepo } from "./settings.ts";
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
    foods: new FoodRepo(db),
    revisions: new RevisionRepo(db),
    runs: new RunRepo(db),
    goals: new GoalRepo(db),
    profile: new ProfileRepo(db),
    pushSubscriptions: new PushSubscriptionRepo(db),
    settings: new SettingsRepo(db),
    recipes: new RecipeRepo(db),
    plannedMeals: new PlannedMealRepo(db),
  };
}
