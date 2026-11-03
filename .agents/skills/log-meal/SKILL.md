---
name: log-meal
description: Analyse a yamt meal (voice-memo transcripts, photos, notes, recipe links, corrections) into foods with grams, grounded in the user's history, package labels, Open Food Facts and USDA, and save it as a revision with the yamt MCP tools. Use for yamt's background meal analysis, and whenever the user asks to log, analyse, re-analyse or correct a meal in yamt.
---

# Log a meal

You turn what the user captured for one meal into a list of items: a food (with its nutrients per
100 g) and the grams eaten, each with where it came from and how sure you are. yamt computes every
total from those items. **You read and judge; yamt calculates.** Never state calorie or macro
totals yourself, and never invent nutrient numbers when a real source exists.

The tools (yamt MCP server, `mcp__yamt__*`):

- `get_meal`: every live capture of the meal, the current revision and the earlier ones.
- `search_foods`: personal history first, then Open Food Facts, then USDA FoodData Central.
- `lookup_barcode`: a packaged product by EAN/UPC. `get_food`: a food's full profile and portions.
- `create_food`: a food from a package label (`label`) or one you derived (`custom`).
- `fetch_recipe`: a recipe page from a link capture.
- `save_meal_revision`: saves your analysis as the meal's new revision and returns yamt's totals.

## 1. Read everything

Call `get_meal` first and read every capture before you decide anything:

- **Voice memos** (`transcript.text`): usually German, dictated while cooking or eating, often
  rambling. Speech-to-text garbles brand names and numbers ("Schier" may be Skyr, "zwo" is zwei);
  read them for meaning. Spoken amounts count as given: "zweihundert Gramm" is 200 g. A transcript
  with status `failed` is missing: work from the rest and say so in an assumption.
- **Photos**: attached to the prompt or listed with a local path (open it with your file-reading
  tool). Look for the plate and its size, packages, **barcodes and nutrition tables**, scales
  showing a weight, receipts and menus.
- **Text notes** and **links** (`url`): a recipe link goes through `fetch_recipe`; any other
  product or restaurant page you may fetch with web fetch if it helps.
- **Corrections** and **answers**: the user's word beats everything else, including photos and
  earlier revisions. An answer names the question it answers (`answersQuestionId`).
- Times: the meal's `eatenAt` and each capture's `at` are local times with offset.

## 2. Re-analysis: start from the previous revision

If the meal has a current revision, this is a re-analysis (the user added captures, a correction
or answers). Start from that revision: keep its items and assumptions where nothing new
contradicts them, and change exactly what the new material says (captures marked
`afterCurrentRevision`, corrections, answers). Don't ask again what was answered, and don't
quietly drop items the user didn't object to. The new revision is complete on its own: repeat the
unchanged items, don't save only the difference.

## 3. Split the meal into items

- One item per food as eaten: "2 Scheiben Vollkornbrot", "Butter", "Gouda", not "Käsebrot".
- **Home-cooked dishes**: split into ingredients when the captures name them (the usual case for
  dictated cooking). For a batch, work out the whole pot, then the share eaten ("die Hälfte",
  "ein Drittel der Pfanne", or eaten weight ÷ total cooked weight), and scale every ingredient.
- **Bought or restaurant dishes** without a recipe: one item for the dish from a database
  (e.g. "Döner Kebab", "Pizza Margherita"), plus what clearly comes on top (extra cheese, sauce).
- Count drinks (milk in coffee, juice, beer, wine, soft drinks) and the small things that add up:
  sugar, honey, sauces, dressings, nuts, butter on bread, toppings.
- Leave out what is negligible (water, black coffee or tea, spices, a squeeze of lemon: roughly
  under 10 kcal together).

## 4. Ground every item, in this order

1. **Personal history.** `search_foods` lists foods from the user's earlier meals first
   (`foundIn: "history"`). They are the products the user actually buys; take one when it is the
   same product or an obvious match.
2. **Barcode or label on a photo.** Read the barcode digits and call `lookup_barcode`. If it is
   unknown, or Open Food Facts lacks energy or macros or disagrees with the label in the photo,
   read the nutrition table and `create_food` with `source: "label"`, the barcode, the photo's
   `captureId`, and every value per 100 g. German labels: *Brennwert* (kJ/kcal), *Fett*, *davon
   gesättigte Fettsäuren*, *Kohlenhydrate*, *davon Zucker*, *Ballaststoffe*, *Eiweiß*, *Salz*. Use
   the per-100 g column; if the label only gives values per serving, convert with the serving
   size. Packaging also gives the pack weight ("Inhalt 500 g"), which helps with amounts.
   **Carbohydrate means available carbohydrate, excluding fiber**, as on EU labels:
   *Kohlenhydrate* goes into `carbohydrate` as printed, *Ballaststoffe* into `fiber`. A US or
   Canadian label's "Total Carbohydrate" includes fiber: enter it minus "Dietary Fiber". yamt maps
   Open Food Facts and USDA to the same convention.
3. **Open Food Facts** (via `search_foods`): branded and packaged products sold in Germany. Search
   with the German product name and the brand ("skyr natur arla", "haferflocken kölln").
4. **USDA FoodData Central** (via `search_foods`, e.g. `sources: ["fdc"]`): generic foods and raw
   ingredients, in English ("oats, rolled", "rice, white, cooked", "chicken breast, raw",
   "olive oil"). Its portions (1 tbsp, 1 cup, 1 medium) help with household measures.
5. **Estimate**, only when nothing fits: `estimatePer100g` with provenance `estimate`, low
   confidence, and a note why. Same convention: `carbohydrate` without fiber, fiber separately.

Check each pick: the right state (raw/cooked, dry/prepared, drained), the right product (whole vs
skimmed milk, wholemeal vs white), plausible numbers (energy ≈ 4 × protein + 4 × carbohydrate +
9 × fat + 2 × fiber, roughly; no 0 g fat for cheese). Prefer a candidate with complete macros. Use `get_food`
when you need its portions or full profile.

## 5. Amounts

From best to worst; say in the item's `note` how you got the amount when it isn't obvious:

- **Weighed** by the user (spoken, typed, a scale in a photo): use it, provenance `weighed`,
  usually high confidence. Note whether it was weighed raw or cooked if it matters.
- **Package amounts**: a whole pack, a cup, "half the 400 g can" → from the label or pack size.
- **Household measures** via the food's portions or common values: 1 EL (tablespoon) oil ≈ 10–14 g,
  1 TL (teaspoon) ≈ 4–5 g, a slice of bread 40–50 g, a medium egg ≈ 50 g without shell.
- **Visual estimates** from photos: judge against the plate (a dinner plate is about 26–28 cm),
  cutlery, hands or the packaging; state the estimate as an assumption, medium or low confidence.

**Cooked vs raw.** The weight and the food entry must describe the same state. Dry pasta, rice,
oats or lentils that were weighed dry take the dry/raw entry; weighed after cooking, the cooked
entry. Never multiply a cooked weight by dry values: that triples the carbohydrates. Meat and fish
weighed raw take the raw entry (cooking loses about a quarter of the weight in water). Rough
factors when you have to convert: pasta dry → cooked × 2.2–2.5, rice × 2.5–3, meat raw → cooked
× 0.7–0.75. When a dish was weighed as a whole (a portion of risotto), either split it into its
ingredients by share or use a database entry for the prepared dish, not the raw ingredients at
the cooked weight.

## 6. Fats and oils: the most-missed macro

Fat is where meal logs go most wrong: it is dense (9 kcal/g), mostly invisible, and rarely
mentioned. Whenever food was fried, sautéed, roasted, baked with fat, dressed, buttered or comes
from a restaurant, add the fat as its own item (oil, butter, cream, dressing, mayonnaise), unless
the food entry already includes it (e.g. a "fried" or "in oil" entry, tuna in oil, a ready meal).

When nobody said how much, assume and write it down: frying for one portion about 1 EL (10–14 g)
oil, roasting vegetables 1–2 EL per tray, salad dressing 1–2 EL, butter 5–10 g per slice of bread,
restaurant dishes on the generous side. Look at the photos for glossy pans, pools of oil or
sauces. If the fat could change the meal by roughly 100 kcal or more, it is a good question.

## 7. Provenance, confidence, assumptions

- Provenance per item: `weighed` (the user gave the weight), `label` (numbers from a package
  label), `database` (a history/OFF/USDA food with a stated or estimated amount), `estimate` (food
  numbers and amount guessed).
- Confidence (`high`, `medium`, `low`) is how sure you are about food and amount together. Mark
  doubtful items low rather than hiding the doubt.
- `assumptions`: every assumption that moves the numbers, one short sentence each, in the
  captures' language: "1 EL Olivenöl zum Braten angenommen", "Portion Reis auf ca. 180 g gekocht
  geschätzt", "Vollmilch angenommen". These are what the user will check and correct.

## 8. Questions: rarely, and only when they matter

Ask at most two questions, and only when the answer could change the meal by roughly **100 kcal
or more** (`impactKcal`) and the captures can't answer it. Typical: how much oil or butter, which
of two very different products, how much of a shared dish was eaten, whether a sauce was eaten.
Not worth a question: small portions, condiments, anything you can see or read.

Still save a complete best-guess revision with the question: the question refines it, it doesn't
replace it. Phrase it short, concrete and answerable in a few words, in the user's language:
"Wie viel Öl war in der Pfanne, eher 1 oder 3 EL?". `whyItMatters` in one short phrase. If
nothing in the captures can be identified at all, save a revision with a question and no items.

## 9. Title, time, summary

- `title`: 2–6 words in the language of the captures (usually German), naming the meal the way
  the user would: "Porridge mit Beeren", "Spaghetti Carbonara", "Döner und Ayran".
- `summary`: one line on what was eaten and how firm the numbers are.
- `eatenAt`: only when the captures say it was eaten at another time than the meal's (`eatenAt` in
  `get_meal`), e.g. "das war gestern um sieben"; ISO 8601 with offset. Otherwise leave it out.

## 10. Save exactly once

When everything is grounded, call `save_meal_revision` **once**, with all items, assumptions and
questions. Before you call it, sanity-check the amounts (a dinner of 3 kg, or 400 g of oil, means a
mistake), because a background run can't save a second time. It returns yamt's totals and the
meal's status; you don't need to repeat them. Then end your turn with one short sentence.

## Background runs and interactive sessions

- **Background analysis** (yamt starts you with a meal id and nothing else to talk to): nobody
  answers during the run, so put questions into the revision. Use only the yamt tools, web fetch
  and search, and reading the meal's photos; don't run commands or write files. A run that ends
  without `save_meal_revision` counts as failed.
- **Interactive session** (a person in Claude Code with the yamt tools): get the meal id from them
  (or find the meal with `get_day_summary`). They are there, so ask them directly instead of
  saving questions, and save when they are happy with the items. Saving again later is fine
  here: each save is a new revision, the earlier ones are kept.
