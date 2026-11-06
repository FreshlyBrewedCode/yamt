import { DEFAULT_PLANNING_SETTINGS, type PlanningSettingsBody } from "@yamt/shared";
import type { SettingsRepo } from "../db/repos/settings.ts";

/**
 * The settings key Settings → Planning (#46) is stored under: suggestions per round, the default
 * recipe source mode and portions to cook, and the preferences (database only, never the repo).
 */
export const PLANNING_SETTINGS_KEY = "planning";

/** The saved planning settings, or `DEFAULT_PLANNING_SETTINGS` until something is saved. */
export function planningSettings(repo: SettingsRepo): PlanningSettingsBody {
  return repo.get<PlanningSettingsBody>(PLANNING_SETTINGS_KEY) ?? DEFAULT_PLANNING_SETTINGS;
}
