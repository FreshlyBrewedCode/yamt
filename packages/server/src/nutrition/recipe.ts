import { isIP } from "node:net";
import { type Fetch, getText, UpstreamError } from "./http.ts";

/** What a recipe page says, from its schema.org `Recipe` JSON-LD. */
export interface Recipe {
  name: string | null;
  description: string | null;
  /** As written ("400 g Spaghetti"); quantities are the page's, for its yield. */
  ingredients: string[];
  /** As written ("4 Portionen"), and as a number when one can be read off. */
  yield: string | null;
  servings: number | null;
  /** Per serving as the page states it (often missing or rough), e.g. {calories: "564 kcal"}. */
  nutrition: Record<string, string> | null;
  instructions: string[];
  totalTime: string | null;
}

export type RecipeResult =
  | { url: string; kind: "recipe"; recipe: Recipe }
  | { url: string; kind: "text"; title: string | null; text: string; truncated: boolean };

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 3 * 1024 * 1024;
/** The plain-text fallback is capped: enough for a recipe, not a whole site. */
const MAX_TEXT = 20_000;

/**
 * Fetches a recipe page server-side and returns its `Recipe` JSON-LD, or the page as plain text
 * when it has none. Only public http(s) URLs: loopback, private and link-local addresses (and
 * redirects to them) are refused, so the agent can't use this to reach services on the machine
 * or the tailnet. (A public name that resolves to a private address is not caught.)
 */
export async function fetchRecipe(fetchFn: Fetch, url: string): Promise<RecipeResult> {
  const {
    text,
    res,
    url: finalUrl,
  } = await getText(fetchFn, url, {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    checkUrl: assertPublicUrl,
    headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "de,en;q=0.8" },
  });
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html|xml|text\/plain/i.test(type)) throw new UpstreamError(`not a web page (${type})`);
  return parseRecipePage(text, finalUrl);
}

export function parseRecipePage(html: string, url: string): RecipeResult {
  const recipe = findRecipe(jsonLdBlocks(html));
  if (recipe) return { url, kind: "recipe", recipe: toRecipe(recipe) };
  const plain = htmlToText(html);
  return {
    url,
    kind: "text",
    title: pageTitle(html),
    text: plain.slice(0, MAX_TEXT),
    truncated: plain.length > MAX_TEXT,
  };
}

// ---- JSON-LD ----------------------------------------------------------------------------------

/** Every `<script type="application/ld+json">` that parses. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) {
    const body = (m[1] ?? "")
      .trim()
      .replace(/^<!\[CDATA\[|\]\]>$/g, "")
      .replace(/^<!--|-->$/g, "")
      .trim();
    if (!body) continue;
    try {
      out.push(JSON.parse(body));
    } catch {
      // some sites put raw newlines inside strings
      try {
        out.push(JSON.parse(body.replace(/[\n\r\t]+/g, " ")));
      } catch {
        // not JSON: ignore this block
      }
    }
  }
  return out;
}

const isRecipeType = (t: unknown) =>
  t === "Recipe" || t === "schema:Recipe" || (Array.isArray(t) && t.some(isRecipeType));

/** The first `Recipe` node anywhere: top level, arrays, `@graph`, or nested (e.g. `mainEntity`). */
export function findRecipe(nodes: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || nodes === null || typeof nodes !== "object") return null;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const found = findRecipe(n, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const node = nodes as Record<string, unknown>;
  if (isRecipeType(node["@type"])) return node;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const found = findRecipe(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function toRecipe(r: Record<string, unknown>): Recipe {
  const yieldText = recipeYield(r.recipeYield);
  return {
    name: str(r.name),
    description: str(r.description),
    ingredients: strings(r.recipeIngredient ?? r.ingredients),
    yield: yieldText,
    servings: servingsOf(r.recipeYield),
    nutrition: nutritionOf(r.nutrition),
    instructions: instructionsOf(r.recipeInstructions),
    totalTime: str(r.totalTime),
  };
}

const str = (v: unknown): string | null => {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const s = decodeEntities(stripTags(v)).replace(/\s+/g, " ").trim();
  return s || null;
};

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
    .map(str)
    .filter((s): s is string => s !== null);

/** `recipeYield` is a number, a string, or a list like ["4", "4 Portionen"]: keep the most telling. */
function recipeYield(v: unknown): string | null {
  const all = strings(v);
  return all.find((s) => /\D/.test(s)) ?? all[0] ?? null;
}

function servingsOf(v: unknown): number | null {
  for (const s of strings(v)) {
    const m = /(\d+(?:[.,]\d+)?)/.exec(s);
    if (m?.[1]) {
      const n = Number(m[1].replace(",", "."));
      if (n > 0 && n < 1000) return n;
    }
  }
  return null;
}

function nutritionOf(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith("@")) continue;
    const s = str(val);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

/** Strings, `HowToStep`s, and `HowToSection`s of steps, flattened in order. */
function instructionsOf(v: unknown, depth = 0): string[] {
  if (depth > 4 || v === null || v === undefined) return [];
  if (typeof v === "string") {
    // one blob: split on line breaks the page kept
    return v
      .split(/\n+|<br\s*\/?>/i)
      .map(str)
      .filter((s): s is string => s !== null);
  }
  if (Array.isArray(v)) return v.flatMap((x) => instructionsOf(x, depth + 1));
  if (typeof v === "object") {
    const node = v as Record<string, unknown>;
    if (node.itemListElement) return instructionsOf(node.itemListElement, depth + 1);
    const text = str(node.text) ?? str(node.name);
    return text ? [text] : [];
  }
  return [];
}

// ---- plain text -------------------------------------------------------------------------------

function pageTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? str(m[1]) : null;
}

/** A readable approximation of the page: scripts, styles and chrome dropped, blocks on lines. */
export function htmlToText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|form)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ");

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  deg: "°",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e] ?? all;
  });
}

// ---- URL guard --------------------------------------------------------------------------------

/** Refuses anything but http(s) to a public host. */
export function assertPublicUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UpstreamError(`only http and https links can be fetched, not ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".ts.net")
  ) {
    throw new UpstreamError(`${host} is not a public host`);
  }
  if (isIP(host) && isPrivateIp(host)) throw new UpstreamError(`${host} is not a public address`);
}

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT, i.e. the tailnet
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1]) return isPrivateIp(mapped[1]);
  // the URL parser writes ::ffff:127.0.0.1 as ::ffff:7f00:1
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (hex?.[1] && hex[2]) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}
