import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetch } from "../src/nutrition/http.ts";

const DIR = join(import.meta.dir, "fixtures", "nutrition");

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * The fixture file a food-database request is recorded in (see fixtures/nutrition/record.ts),
 * or null for a URL that isn't one of OFF's or FDC's.
 */
export function fixtureName(url: string): string | null {
  const u = new URL(url);
  if (u.hostname === "world.openfoodfacts.org") {
    const product = /^\/api\/v2\/product\/([^/]+)$/.exec(u.pathname);
    if (product?.[1]) return `off-product-${product[1]}.json`;
    if (u.pathname === "/cgi/search.pl")
      return `off-legacy-search-${slug(u.searchParams.get("search_terms") ?? "")}.json`;
  }
  if (u.hostname === "search.openfoodfacts.org" && u.pathname === "/search") {
    const q = (u.searchParams.get("q") ?? "").replace(/\s*countries_tags:.*$/, "");
    return `off-search-${slug(q)}.json`;
  }
  if (u.hostname === "api.nal.usda.gov") {
    if (u.pathname === "/fdc/v1/foods/search")
      return `fdc-search-${slug(u.searchParams.get("query") ?? "")}.json`;
    const food = /^\/fdc\/v1\/food\/(\d+)$/.exec(u.pathname);
    if (food?.[1]) return `fdc-food-${food[1]}.json`;
  }
  return null;
}

export const readFixture = (name: string): string => readFileSync(join(DIR, name), "utf8");

export interface FixtureFetch extends Fetch {
  /** Every URL requested, in order. */
  calls: string[];
  /** Answer these URLs (exact match) with a status, e.g. to simulate an outage. */
  fail: Map<string | RegExp, number>;
  /** Extra pages, e.g. a recipe URL → its HTML. */
  pages: Map<string, { body: string; type?: string; status?: number; headers?: Record<string, string> }>;
}

/**
 * A fetch that answers from the recorded fixtures and never touches the network: an unknown URL
 * is a test bug and throws. A missing fixture file answers 404, like OFF/FDC for unknown ids.
 */
export function fixtureFetch(): FixtureFetch {
  const calls: string[] = [];
  const fail = new Map<string | RegExp, number>();
  const pages: FixtureFetch["pages"] = new Map();
  const fn = (async (input: string) => {
    calls.push(input);
    for (const [pattern, status] of fail) {
      if (typeof pattern === "string" ? pattern === input : pattern.test(input)) {
        return new Response("<html>unavailable</html>", { status, headers: { "content-type": "text/html" } });
      }
    }
    const page = pages.get(input);
    if (page) {
      return new Response(page.body, {
        status: page.status ?? 200,
        headers: { "content-type": page.type ?? "text/html; charset=utf-8", ...page.headers },
      });
    }
    const name = fixtureName(input);
    if (!name) throw new Error(`test fetched an unexpected URL: ${input}`);
    if (!existsSync(join(DIR, name))) return Response.json({ status: 0 }, { status: 404 });
    return new Response(readFixture(name), { headers: { "content-type": "application/json" } });
  }) as FixtureFetch;
  fn.calls = calls;
  fn.fail = fail;
  fn.pages = pages;
  return fn;
}
