import { describe, expect, test } from "bun:test";
import {
  assertPublicUrl,
  decodeEntities,
  fetchRecipe,
  findRecipe,
  isPrivateIp,
  jsonLdBlocks,
  parseRecipePage,
} from "../src/nutrition/recipe.ts";
import { fixtureFetch, readFixture } from "./nutrition-fixtures.ts";

const page = (jsonLd: unknown, body = "") =>
  `<html><head><title>T</title><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body>${body}</body></html>`;

describe("JSON-LD recipes", () => {
  test("chefkoch.de: @graph, a yield list, HowToSections, nutrition per portion", () => {
    const res = parseRecipePage(
      readFixture("chefkoch-carbonara.html"),
      "https://www.chefkoch.de/rezepte/x.html",
    );
    if (res.kind !== "recipe") throw new Error("expected a recipe");
    const r = res.recipe;
    expect(r.name).toBe("Spaghetti Carbonara - schnell & einfach");
    expect(r.ingredients).toContain("400 g Spaghetti (oder Tortellini)");
    expect(r.ingredients).toHaveLength(7);
    expect(r.yield).toBe("4 Portionen");
    expect(r.servings).toBe(4);
    expect(r.nutrition).toMatchObject({
      calories: "564 kcal",
      proteinContent: "26.6 g",
      servingSize: "1 Portion",
    });
    expect(r.instructions[0]).toStartWith("Die Pasta in reichlich Salzwasser");
    expect(r.instructions.length).toBeGreaterThan(1);
    expect(r.totalTime).toBe("PT20M");
  });

  test("a top-level array, @type as a list, string instructions, entities", () => {
    const res = parseRecipePage(
      page([
        { "@type": "WebSite", name: "x" },
        {
          "@type": ["Recipe", "NewsArticle"],
          name: "K&auml;sesp&auml;tzle",
          recipeIngredient: ["500 g Sp&auml;tzle", "200 g Bergk&#228;se", " "],
          recipeYield: 3,
          recipeInstructions: "Spätzle kochen.\nKäse reiben.<br>Schichten.",
        },
      ]),
      "https://example.com/r",
    );
    expect(res).toMatchObject({
      kind: "recipe",
      recipe: {
        name: "Käsespätzle",
        ingredients: ["500 g Spätzle", "200 g Bergkäse"],
        yield: "3",
        servings: 3,
        nutrition: null,
        instructions: ["Spätzle kochen.", "Käse reiben.", "Schichten."],
      },
    });
  });

  test("a recipe nested in mainEntity; broken blocks are skipped", () => {
    const html = `<script type="application/ld+json">{ broken</script>${page({
      "@type": "WebPage",
      mainEntity: { "@type": "Recipe", name: "Nested", recipeIngredient: "1 Ei" },
    })}`;
    expect(jsonLdBlocks(html)).toHaveLength(1);
    expect(findRecipe(jsonLdBlocks(html))?.name).toBe("Nested");
    expect(parseRecipePage(html, "u")).toMatchObject({ kind: "recipe", recipe: { ingredients: ["1 Ei"] } });
  });

  test("no recipe: the page as plain text, without scripts and navigation", () => {
    const html = `<html><head><title>Omas Kuchen</title><style>p{}</style></head><body>
      <nav>Menü</nav><h1>Omas Kuchen</h1><ul><li>200 g Mehl</li><li>100 g Zucker &amp; Butter</li></ul>
      <script>track()</script><p>Alles   verrühren.</p></body></html>`;
    const res = parseRecipePage(html, "https://example.com/k");
    expect(res).toMatchObject({ kind: "text", title: "Omas Kuchen", truncated: false });
    if (res.kind !== "text") throw new Error("expected text");
    expect(res.text).toBe("Omas Kuchen\n- 200 g Mehl\n- 100 g Zucker & Butter\nAlles verrühren.");
  });

  test("long pages are truncated", () => {
    const res = parseRecipePage(`<p>${"Wort ".repeat(10_000)}</p>`, "u");
    expect(res).toMatchObject({ kind: "text", truncated: true });
    if (res.kind === "text") expect(res.text.length).toBe(20_000);
  });

  test("entities", () => {
    expect(decodeEntities("&frac12; TL &amp; 1&nbsp;Prise &#x2013; &unknown;")).toBe(
      "½ TL & 1 Prise – &unknown;",
    );
  });
});

describe("fetching", () => {
  test("fetches the page and parses it", async () => {
    const f = fixtureFetch();
    const url = "https://www.chefkoch.de/rezepte/1491131254215808/Spaghetti-Carbonara.html";
    f.pages.set(url, { body: readFixture("chefkoch-carbonara.html") });
    expect(await fetchRecipe(f, url)).toMatchObject({ kind: "recipe", url, recipe: { servings: 4 } });
  });

  test("follows redirects, but never to a private address", async () => {
    const f = fixtureFetch();
    f.pages.set("https://example.com/short", {
      body: "",
      status: 302,
      headers: { location: "https://example.com/recipe" },
    });
    f.pages.set("https://example.com/recipe", { body: page({ "@type": "Recipe", name: "R" }) });
    expect(await fetchRecipe(f, "https://example.com/short")).toMatchObject({
      url: "https://example.com/recipe",
      recipe: { name: "R" },
    });

    f.pages.set("https://example.com/evil", {
      body: "",
      status: 301,
      headers: { location: "http://127.0.0.1:7890/api/meals" },
    });
    await expect(fetchRecipe(f, "https://example.com/evil")).rejects.toThrow("not a public address");
    expect(f.calls).not.toContain("http://127.0.0.1:7890/api/meals");
  });

  test("refuses what isn't a web page", async () => {
    const f = fixtureFetch();
    f.pages.set("https://example.com/a.pdf", { body: "%PDF", type: "application/pdf" });
    await expect(fetchRecipe(f, "https://example.com/a.pdf")).rejects.toThrow("not a web page");
  });

  test("the URL guard", () => {
    for (const bad of [
      "http://localhost:7890/",
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://10.1.2.3/",
      "http://192.168.0.1/",
      "http://100.100.100.100/",
      "http://169.254.169.254/latest/meta-data",
      "http://host.tailnet-example.ts.net/",
      "http://2130706433/",
      "file:///etc/passwd",
    ]) {
      expect(() => assertPublicUrl(new URL(bad))).toThrow();
    }
    for (const ok of ["https://www.chefkoch.de/rezepte/1/x.html", "http://93.184.215.14/"]) {
      expect(() => assertPublicUrl(new URL(ok))).not.toThrow();
    }
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("fd7a:115c:a1e0::1")).toBe(true);
    expect(isPrivateIp("2a00:1450:4001::1")).toBe(false);
  });
});
