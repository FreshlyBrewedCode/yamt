#!/usr/bin/env bun
// SPIKE #38: made-up history for a scratch server (never the real one): a cut goal, a weight,
// twelve analysed meals over the last ten days (German home cooking, foods from Open Food Facts
// via search_foods (no FDC key in the spike), saved with save_meal_revision so they become history foods), a
// leftover list and preferences.
//
//   bun packages/server/spike38/seed.ts --data-dir /tmp/yamt-spike38 --port 7961
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { addDays } from "@yamt/shared";
import { dayRange, localDate, localTimeZone } from "../src/domain/time.ts";
import { PlanningStore } from "../src/planning/store.ts";

const { values: a } = parseArgs({
  options: {
    "data-dir": { type: "string", default: "/tmp/yamt-spike38" },
    port: { type: "string", default: "7961" },
  },
});
const dataDir = a["data-dir"]!;
if (!dataDir.startsWith("/tmp/")) throw new Error("seed only scratch data dirs under /tmp");
const base = `http://127.0.0.1:${a.port}`;
const tz = localTimeZone();
const today = localDate(Date.now(), tz);
const at = (daysAgo: number, hh: number, mm = 0) =>
  dayRange(addDays(today, -daysAgo), tz).from + (hh * 60 + mm) * 60_000;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", origin: base },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return JSON.parse(text);
}

const token = readFileSync(join(dataDir, "mcp-token"), "utf8").trim();
const mcp = new Client({ name: "spike38-seed", version: "0" });
await mcp.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);
async function call(name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = r.content[0]?.text ?? "";
  if (r.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

/** [description, grams, query, source, plausible kcal per 100 g] */
type Ing = [string, number, string, "off" | "fdc", [number, number], RegExp?];
const foods = new Map<string, { foodId: string; name: string }>();
async function food(query: string, source: "off" | "fdc", [lo, hi]: [number, number], not?: RegExp) {
  const key = `${source}:${query}`;
  const hit = foods.get(key);
  if (hit) return hit;
  const r = await call("search_foods", { query, sources: [source], limit: 10 });
  const list = r.candidates as {
    foodId: string;
    name: string;
    brand: string | null;
    per100g: { energyKcal: number | null };
  }[];
  const c = list.find(
    (x) =>
      x.per100g.energyKcal !== null &&
      x.per100g.energyKcal >= lo &&
      x.per100g.energyKcal <= hi &&
      !not?.test(`${x.name} ${x.brand ?? ""}`),
  );
  let f: { foodId: string; name: string };
  if (c) f = { foodId: c.foodId, name: `${c.name}${c.brand ? ` (${c.brand})` : ""}` };
  else {
    // Open Food Facts is thin on plain produce and USDA is off in the spike: a typical value
    const per100g = FALLBACK[query];
    if (!per100g) throw new Error(`no food for ${query} (${source}): ${list.map((x) => x.name).join(" | ")}`);
    const name = `${query.charAt(0).toUpperCase()}${query.slice(1)}, roh`;
    const created = await call("create_food", {
      source: "custom",
      name,
      per100g,
      note: "typical value (spike seed)",
    });
    f = { foodId: created.foodId, name: `${name} [custom]` };
  }
  foods.set(key, f);
  return f;
}

/** Typical values per 100 g (rounded, EU convention) for produce OFF has no clean entry for. */
const FALLBACK: Record<string, Record<string, number>> = {
  zwiebeln: { energyKcal: 33, protein: 1.2, fat: 0.2, carbohydrate: 6.4, fiber: 1.8, sugars: 4.2, salt: 0 },
  brokkoli: { energyKcal: 35, protein: 3.8, fat: 0.2, carbohydrate: 2.7, fiber: 3, sugars: 1.7, salt: 0.03 },
  heidelbeeren: {
    energyKcal: 42,
    protein: 0.6,
    fat: 0.6,
    carbohydrate: 7.4,
    fiber: 4.9,
    sugars: 7.4,
    salt: 0,
  },
  kartoffeln: { energyKcal: 71, protein: 2, fat: 0.1, carbohydrate: 14.8, fiber: 2.1, sugars: 0.8, salt: 0 },
  blattspinat: {
    energyKcal: 23,
    protein: 2.9,
    fat: 0.4,
    carbohydrate: 0.6,
    fiber: 2.6,
    sugars: 0.4,
    salt: 0.17,
  },
  salatgurke: { energyKcal: 13, protein: 0.6, fat: 0.2, carbohydrate: 1.8, fiber: 0.5, sugars: 1.7, salt: 0 },
  champignons: {
    energyKcal: 22,
    protein: 2.9,
    fat: 0.3,
    carbohydrate: 0.6,
    fiber: 2,
    sugars: 0.2,
    salt: 0.02,
  },
  "paprika rot": { energyKcal: 37, protein: 1, fat: 0.4, carbohydrate: 6.4, fiber: 3.6, sugars: 6, salt: 0 },
  zucchini: { energyKcal: 20, protein: 1.6, fat: 0.4, carbohydrate: 2.1, fiber: 1.1, sugars: 1.9, salt: 0 },
};

const meals: { daysAgo: number; hh: number; title: string; note: string; items: Ing[] }[] = [
  {
    daysAgo: 9,
    hh: 19,
    title: "Spaghetti Bolognese",
    note: "Spaghetti Bolognese, 120 g Nudeln, 150 g Hack",
    items: [
      ["Spaghetti, trocken", 120, "spaghetti", "off", [330, 380], /norge/i],
      ["Rinderhackfleisch", 150, "rinderhackfleisch", "off", [100, 260]],
      ["Passierte Tomaten", 200, "passierte tomaten", "off", [20, 45]],
      ["Zwiebel", 60, "zwiebeln", "off", [20, 50], /duo|würfel|röst|gebraten/i],
      ["Olivenöl", 10, "olivenöl", "off", [800, 900]],
      ["Parmesan", 10, "parmigiano reggiano", "off", [370, 420]],
    ],
  },
  {
    daysAgo: 8,
    hh: 13,
    title: "Hähnchen-Reis-Bowl mit Brokkoli",
    note: "Bowl mit Hähnchen, Reis, Brokkoli",
    items: [
      [
        "Hähnchenbrust, roh",
        180,
        "hähnchenbrustfilet",
        "off",
        [95, 125],
        /aufschnitt|gegart|gebraten|geräuchert|wurst|paprika|kräuter|mariniert/i,
      ],
      ["Basmatireis, trocken", 80, "basmati reis", "off", [330, 370]],
      ["Brokkoli", 150, "brokkoli", "off", [20, 45]],
      ["Sojasauce", 15, "sojasauce", "off", [40, 90]],
      ["Rapsöl", 10, "rapsöl", "off", [800, 900]],
    ],
  },
  {
    daysAgo: 7,
    hh: 19,
    title: "Rote-Linsen-Dal",
    note: "Linsen-Dal mit Kokosmilch",
    items: [
      ["Rote Linsen, trocken", 90, "rote linsen", "off", [320, 370]],
      ["Kokosmilch light", 100, "kokosmilch light", "off", [60, 110]],
      ["Gehackte Tomaten", 150, "gehackte tomaten", "off", [15, 40]],
      ["Zwiebel", 60, "zwiebeln", "off", [20, 50], /duo|würfel|röst|gebraten/i],
      ["Rapsöl", 10, "rapsöl", "off", [800, 900]],
    ],
  },
  {
    daysAgo: 6,
    hh: 8,
    title: "Skyr mit Haferflocken und Heidelbeeren",
    note: "Skyr-Bowl",
    items: [
      ["Skyr natur", 250, "skyr natur", "off", [55, 70]],
      ["Haferflocken", 50, "haferflocken", "off", [350, 390]],
      ["Heidelbeeren", 100, "heidelbeeren", "off", [35, 65]],
    ],
  },
  {
    daysAgo: 6,
    hh: 19,
    title: "Lachs mit Kartoffeln und Spinat",
    note: "Lachs, Kartoffeln, Blattspinat mit Butter",
    items: [
      ["Lachsfilet, roh", 150, "lachsfilet", "off", [150, 230]],
      ["Kartoffeln, roh", 250, "kartoffeln", "off", [60, 90]],
      ["Blattspinat", 150, "blattspinat", "off", [15, 35]],
      ["Butter", 10, "butter", "off", [700, 760]],
    ],
  },
  {
    daysAgo: 5,
    hh: 19,
    title: "Chili con Carne",
    note: "Chili mit Hack, Bohnen, Mais",
    items: [
      ["Rinderhackfleisch", 150, "rinderhackfleisch", "off", [100, 260]],
      ["Kidneybohnen, abgetropft", 120, "kidneybohnen", "off", [80, 130]],
      ["Mais, abgetropft", 60, "gemüsemais", "off", [60, 110]],
      ["Passierte Tomaten", 200, "passierte tomaten", "off", [20, 45]],
      ["Zwiebel", 60, "zwiebeln", "off", [20, 50], /duo|würfel|röst|gebraten/i],
      ["Rapsöl", 10, "rapsöl", "off", [800, 900]],
    ],
  },
  {
    daysAgo: 4,
    hh: 13,
    title: "Vollkornbrot mit Hüttenkäse",
    note: "2 Scheiben Vollkornbrot, Hüttenkäse, Gurke",
    items: [
      ["Vollkornbrot", 100, "vollkornbrot", "off", [190, 250]],
      ["Hüttenkäse", 200, "hüttenkäse", "off", [70, 110]],
      ["Gurke", 100, "salatgurke", "off", [5, 25]],
    ],
  },
  {
    daysAgo: 3,
    hh: 19,
    title: "Putengeschnetzeltes mit Champignons und Reis",
    note: "Pute, Champignons, Kochsahne, Reis",
    items: [
      [
        "Putenbrust, roh",
        180,
        "putenbrust",
        "off",
        [95, 125],
        /aufschnitt|gegart|gebraten|geräuchert|wurst|paprika|kräuter|mariniert/i,
      ],
      ["Basmatireis, trocken", 80, "basmati reis", "off", [330, 370]],
      ["Champignons", 150, "champignons", "off", [15, 35]],
      ["Kochsahne 15 %", 50, "kochsahne", "off", [140, 200]],
      ["Rapsöl", 10, "rapsöl", "off", [800, 900]],
    ],
  },
  {
    daysAgo: 2,
    hh: 19,
    title: "Ofengemüse mit Feta",
    note: "Blech mit Kartoffeln, Paprika, Zucchini, Feta",
    items: [
      ["Kartoffeln, roh", 200, "kartoffeln", "off", [60, 90]],
      ["Paprika rot", 150, "paprika rot", "off", [20, 45]],
      ["Zucchini", 150, "zucchini", "off", [12, 30]],
      ["Feta", 75, "feta", "off", [230, 300]],
      ["Olivenöl", 15, "olivenöl", "off", [800, 900]],
    ],
  },
  {
    daysAgo: 1,
    hh: 19,
    title: "Hähnchen-Curry mit Reis",
    note: "Curry mit Hähnchen, Kokosmilch light, Paprika",
    items: [
      [
        "Hähnchenbrust, roh",
        180,
        "hähnchenbrustfilet",
        "off",
        [95, 125],
        /aufschnitt|gegart|gebraten|geräuchert|wurst|paprika|kräuter|mariniert/i,
      ],
      ["Kokosmilch light", 100, "kokosmilch light", "off", [60, 110]],
      ["Basmatireis, trocken", 75, "basmati reis", "off", [330, 370]],
      ["Paprika rot", 100, "paprika rot", "off", [20, 45]],
      ["Rapsöl", 10, "rapsöl", "off", [800, 900]],
    ],
  },
  {
    daysAgo: 0,
    hh: 8,
    title: "Skyr mit Haferflocken und Heidelbeeren",
    note: "Skyr-Bowl wie immer",
    items: [
      ["Skyr natur", 250, "skyr natur", "off", [55, 70]],
      ["Haferflocken", 50, "haferflocken", "off", [350, 390]],
      ["Heidelbeeren", 100, "heidelbeeren", "off", [35, 65]],
    ],
  },
  {
    daysAgo: 0,
    hh: 13,
    title: "Vollkornbrot mit Hüttenkäse und Ei",
    note: "Brot, Hüttenkäse, 2 Eier",
    items: [
      ["Vollkornbrot", 100, "vollkornbrot", "off", [190, 250]],
      ["Hüttenkäse", 200, "hüttenkäse", "off", [70, 110]],
      ["2 Eier, gekocht", 110, "eier", "off", [130, 160]],
    ],
  },
];

const goals = await api("GET", "/api/goals");
if (goals.goals.length === 0) {
  await api("POST", "/api/goals", {
    energyKcal: 2200,
    protein: 160,
    fat: 70,
    carbohydrate: 220,
    fiber: 30,
    note: "Cut (made-up)",
    effectiveFrom: addDays(today, -20),
  });
  await api("POST", "/api/weight", { kg: 82.4, measuredAt: at(0, 7), note: "" });
}

for (const m of meals) {
  const eatenAt = at(m.daysAgo, m.hh);
  const { meal } = await api("POST", "/api/meals", { eatenAt });
  await api("POST", `/api/meals/${meal.id}/captures`, { kind: "text", text: m.note, capturedAt: eatenAt });
  await api("PATCH", `/api/meals/${meal.id}`, { eatenAt });
  const items = [];
  for (const [description, grams, query, source, range, not] of m.items) {
    const f = await food(query, source, range, not);
    items.push({ foodId: f.foodId, description, grams, provenance: "database", confidence: "medium" });
    console.log(`  ${description} ${grams} g → ${f.name}`);
  }
  const r = await call("save_meal_revision", { mealId: meal.id, title: m.title, items, assumptions: [] });
  console.log(
    `${addDays(today, -m.daysAgo)} ${m.hh}:00 ${m.title}: ${r.revision.totals.energyKcal} kcal, ${r.revision.totals.protein} g protein`,
  );
}

new PlanningStore(dataDir).setContext({
  leftovers: [
    { name: "Hokkaido-Kürbis", amount: "½ Kürbis", grams: 500, since: addDays(today, -2) },
    { name: "Feta", amount: "200 g, Packung angebrochen", grams: 200, since: addDays(today, -2) },
  ],
  preferences: {
    dislikes: ["Rosenkohl", "Rosinen", "Koriander"],
    neverEat: ["Innereien"],
    equipment: ["Herd", "Backofen", "Airfryer", "Pürierstab"],
    weekdayCookingMinutes: 40,
    favouriteSites: ["chefkoch.de", "eatsmarter.de"],
    notes: ["Kocht meist für sich allein, gern zwei Portionen für den nächsten Tag."],
  },
});
console.log("leftovers and preferences saved");
await mcp.close();
