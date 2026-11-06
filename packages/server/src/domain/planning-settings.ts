import { DEFAULT_PLANNING_SETTINGS, type PlanningSettingsBody } from "@yamt/shared";
import type { SettingsRepo } from "../db/repos/settings.ts";

/**
 * The settings key Settings → Planning (#46) is stored under: suggestions per round, the default
 * recipe source mode and portions to cook, the preferences (database only, never the repo) and
 * the nightly run (#48).
 */
export const PLANNING_SETTINGS_KEY = "planning";

/**
 * The saved planning settings, or `DEFAULT_PLANNING_SETTINGS` until something is saved; a value
 * saved before the nightly options existed (#48) gets their defaults.
 */
export function planningSettings(repo: SettingsRepo): PlanningSettingsBody {
  const saved = repo.get<Partial<PlanningSettingsBody>>(PLANNING_SETTINGS_KEY);
  return saved ? { ...DEFAULT_PLANNING_SETTINGS, ...saved } : DEFAULT_PLANNING_SETTINGS;
}
