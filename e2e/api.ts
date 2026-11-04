/**
 * Headers for API writes made by the specs themselves (seeding meals, goals, weights): writes need
 * our own Origin (`sameOrigin`). A browser sends it; Playwright's request context doesn't.
 */
export const OWN_ORIGIN = { origin: `http://localhost:${process.env.YAMT_E2E_PORT ?? 7898}` };
