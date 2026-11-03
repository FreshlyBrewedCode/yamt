#!/usr/bin/env bun
/**
 * Re-records the food-database fixtures from the live APIs (never run by the gate):
 *
 *   FDC_API_KEY=DEMO_KEY bun packages/server/test/fixtures/nutrition/record.ts
 *
 * Generic foods and common products only, nothing personal. Bodies are stored as answered; the
 * FDC key is only ever in the request URL, never in a fixture. `fixtureFetch` (../../nutrition-
 * fixtures.ts) maps request URLs back to these files.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FDC_URLS } from "../../../src/nutrition/fdc.ts";
import { USER_AGENT } from "../../../src/nutrition/http.ts";
import { OFF_URLS } from "../../../src/nutrition/off.ts";
import { fixtureName } from "../../nutrition-fixtures.ts";

const key = process.env.FDC_API_KEY;
if (!key) throw new Error("set FDC_API_KEY (DEMO_KEY works, with a low rate limit)");

const urls = [
  OFF_URLS.product("4337185761638"), // K-Classic Skyr natur
  OFF_URLS.product("4260070610493"), // K-Classic Zarte Haferflocken
  OFF_URLS.product("0000000000000"), // unknown
  OFF_URLS.search("skyr", 5),
  OFF_URLS.search("haferflocken", 5),
  OFF_URLS.legacySearch("skyr", 5),
  FDC_URLS.search("oats", 5, key),
  FDC_URLS.food("171413", key), // Oil, olive, salad or cooking (SR Legacy)
];

for (const url of urls) {
  const name = fixtureName(url);
  if (!name) throw new Error(`no fixture name for ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const body = await res.text();
  if (!res.ok && res.status !== 404) {
    console.warn(`${res.status} for ${name}, not written`);
    continue;
  }
  writeFileSync(join(import.meta.dir, name), `${JSON.stringify(JSON.parse(body), null, 1)}\n`);
  console.log(`${res.status} ${name} (${body.length} bytes)`);
  await Bun.sleep(1500);
}
