/**
 * Headers for API writes made by the specs themselves (seeding meals, goals, weights): writes need
 * our own Origin (`sameOrigin`). A browser sends it; Playwright's request context doesn't.
 */
export const OWN_ORIGIN = { origin: `http://localhost:${process.env.YAMT_E2E_PORT ?? 7898}` };

/** The calendar spec's own server (see playwright.config.ts): a store nobody else touches. */
export const CALENDAR_URL = `http://localhost:${process.env.YAMT_E2E_CALENDAR_PORT ?? Number(process.env.YAMT_E2E_PORT ?? 7898) - 1}`;
