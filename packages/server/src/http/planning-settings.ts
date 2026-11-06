import { PlanningSettingsBody, type PlanningSettingsResponse } from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { PLANNING_SETTINGS_KEY, planningSettings } from "../domain/planning-settings.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** Settings → Planning (#46, the nightly options #48), mounted under /api behind auth. Paths: `planningSettingsPaths`. */
export function planningSettingsRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.get("/planning/settings", (c) =>
    c.json<PlanningSettingsResponse>({ settings: planningSettings(s.repos.settings) }),
  );

  r.put("/planning/settings", async (c) => {
    const settings = PlanningSettingsBody.parse(await readJson(c));
    s.repos.settings.set(PLANNING_SETTINGS_KEY, settings);
    // the nightly run's job follows its options at once (#48)
    s.nightly.schedule();
    return c.json<PlanningSettingsResponse>({ settings });
  });

  return r;
}
