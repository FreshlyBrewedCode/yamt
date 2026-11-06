# Spike #38: suggestion generation, time and cost

Ten real rounds on 5–6 Nov 2026 against a scratch server with made-up history (cut goal 2,200 kcal /
160 g protein, twelve analysed meals over ten days, leftovers ½ Hokkaido and 200 g feta). Harness
claude-agent-acp 0.100.0 driven like `analysis/job.ts` (`round.ts`). The prototype skill
(`.agents/skills/plan-meals/SKILL.md`) and tools (`src/planning/`) were the same for every run.

**No USDA in any run.** yamt's FDC search answers HTTP 400 (see Bugs), and `DEMO_KEY` is now 10
requests an hour. Every remote lookup went to Open Food Facts, whose client allows 5 searches in a
burst, then one every 6 s. With FDC, generic ingredients would skip that queue.

"Pumpkin" = "Irgendwas mit dem restlichen Kürbis, heute Abend. Kein Ofen." (dinner today, ≤ 45 min,
1 portion; the slot's budget is all that is still open: 1,278 kcal / 82 g protein). "Tue–Thu" =
"Abendessen Dienstag bis Donnerstag, höchstens 40 Minuten" (3 dinners, 2 portions each, budget
811 kcal / 59 g protein per dinner).

| # | Configuration | Outline | 1st | Total | Tool calls | Out tok | Cost | Quality |
|---|---|---|---|---|---|---|---|---|
| 1 | Pumpkin, *based on*, Opus default, **no matcher** | 20 s | 87 s | 201 s | 40 (25 `search_foods`) | 16.2k | $1.03 | 3 distinct; 3 estimates (garlic, rucola, leek); #3 fell back to *free* after two 404s; portions sized to the whole open day (330 g shrimp, 350 g tofu); fibre 1.6 g for a tofu wok (OFF lacks fibre) |
| 2 | Same **with matcher** | 19 s | 82 s | 172 s | 17 (3 matcher, 1 search) | 13.6k | $1.05 | 3 proteins; agent replaced 5 of 28 wrong top picks; 0 estimates; Thai curry with coconut milk + basmati a day after a chicken curry with both (variety miss); 280–380 g fish per portion |
| 3 | Pumpkin, *real only* | 33 s | 102 s | 201 s | 25 | 13.9k | $1.02 | Published recipes unchanged: 33–48 g protein of 82 open (expected); idea 3 changed dish (risotto → stew) after the outline; lamb mince estimated |
| 4 | Pumpkin, *free* | 18 s | 67 s | 161 s | 13 | 13.4k | $0.73 | No research; one matcher call 30 s (OFF queue); 1.47 kg risotto portion; 2 estimates (ginger, spring onion) |
| 5 | Tue–Thu, *based on*, 2 portions | 13 s | 71 s | 126 s | 21 | 13.9k | $0.86 | **Best fit**: 751–817 kcal / 61–65 g protein against 811 / 59; airfryer used; shrimp / pork / cod |
| 6 | Pumpkin, *based on*, **Sonnet 5** | 34 s | 164 s | 400 s | 24 | 34.0k | $1.02 | Estimated pumpkin and rice on purpose to "fix" missing fibre; chicken curry a day after chicken curry; 400 g cottage cheese in risotto; one invalid save |
| 7 | Pumpkin, *based on*, **Opus low** | 12 s | 35 s | 88 s | 12 | 7.0k | $0.43 | **Ignored the source mode**: all *free*, no research; otherwise sane, more moderate portions |
| 8 | Steer round 2 of #2: "Weniger Fleisch, und schneller bitte." | 23 s | 100 s | 185 s | 20 | 14.8k | $0.95 | Steer followed: all vegetarian, 20–25 min (was 30–35), no repeats of round 1; 1.37 kg portion; 4 estimates |
| 9 | Pumpkin, *based on*, **1 suggestion** | 11 s | 62 s | 66 s | 7 | 5.7k | $0.38 | One suggestion; what one parallel worker would take |
| 10 | Pumpkin, *based on*, **Opus medium** | 19 s | 69 s | 146 s | 16 | 13.0k | $0.81 | Same behaviour as default: 3× *based on* with URLs; shrimp / beef / salmon; 300 g shrimp per portion |

"Cost" is what Claude Code reports (API prices; a subscription login spends quota instead).
Cached reads made up most of the tokens: 0.17–1.35 M per round.

## Where the time goes (seconds of wall time, overlapping calls counted once)

| # | Turn | Food matching | Web (search, fetch) | Writing saves | Other model time |
|---|---|---|---|---|---|
| 1 no matcher | 201 | 51 | 24 | 68 | 58 |
| 2 matcher | 172 | 23 | 34 | 55 | 60 |
| 4 free | 161 | 43 | 0 | 63 | 55 |
| 5 Tue–Thu | 126 | 16 | 12 | 59 | 39 |
| 6 Sonnet | 400 | 12 | 33 | 108 | 248 |
| 7 Opus low | 88 | 25 | 0 | 33 | 31 |
| 10 Opus medium | 146 | 22 | 24 | 54 | 47 |

- **Writing `save_suggestion` costs ~10–15 s per call.** A tool call's time runs from the moment
  the model starts emitting it, and a suggestion with steps is ~1k tokens. Each `dryRun` writes the
  whole suggestion again: rounds made 1–2 of them (Sonnet 4), so 12–25 s a round went into numbers
  the agent could have had earlier.
- **Food matching** with a warm cache: 0.1–3 s per recipe. Cold: 10–30 s, almost all of it waiting
  for the OFF rate limiter (one search every 6 s after a burst of 5).
- **WebSearch** 6–9 s per call. `fetch_recipe` < 1.5 s; it failed on 404 print pages and a PDF.
- The longest silence between updates was 26 s with Opus and 43 s with Sonnet.

## Matcher (runs 2–10)

204 ingredient lines: the top pick was used for 151 (74 %), a lower candidate for 27 (13 %), and the
other 26 were matched again with `search_foods`, estimated or dropped. The misses are almost all plain
produce, where OFF ranks a processed product first: "Knoblauch granuliert" (7×), "Südsee-Ingwer"
(candied), "Rote Zwiebel Salsa", "Apfel Chips", "Frischer Rucola" at 201 kcal, "Obazda
Lauchzwiebeln". One more miss was a non-lean mince from history for "mager". Opus caught all of
these. Fibre is null on many OFF entries (Hokkaido, rice, cheese, tofu), so fibre per portion comes
out low, and Sonnet replaced good matches with estimates because of it.

Against `search_foods` per ingredient (#1 → #2, the same request): 40 → 17 tool calls, food time
51 → 23 s, total 201 → 172 s (−15 %), 3 → 0 estimates, the same cost. Fewer model turns save little
money, because the context is re-read from the cache each turn.

## Bugs found

- **FDC search is broken in production.** `FDC_URLS.search` encodes `Survey (FNDDS)` as
  `Survey+%28FNDDS%29`, and api.nal.usda.gov answers 400 (nginx). With literal parentheses it
  answers 200. With a key configured, every search lists FDC as unavailable ("HTTP 400"). Found with
  DEMO_KEY in Nov 2026; the recorded fixtures don't catch it.
- `fetch_recipe` refuses PDFs ("not a web page"); Opus fell back to WebFetch.

## Not carried over

The file store, `/mcp?hide=`, the `interactive` scope on everything, `dryRun`.
