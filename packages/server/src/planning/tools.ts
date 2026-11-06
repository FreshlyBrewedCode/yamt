import {
  MAX_STARTERS,
  MAX_SUGGESTIONS,
  MealSlot,
  MIN_STARTERS,
  type NutrientTotals,
  RecipeSourceMode,
  STARTER_KINDS,
  StarterInput,
} from "@yamt/shared";
import { z } from "zod";
import { MAX_WHY_LINES } from "../domain/planning-requests.ts";
import { localDate } from "../domain/time.ts";
import { RecipeItemInput, type Tool, type ToolContext, ToolError, tool } from "../mcp/tools.ts";
import type { Services } from "../services.ts";
import { fitToSlot, openAfter, slotBudget } from "./budget.ts";
import { planningContext, roundOf } from "./context.ts";
import { IngredientInput, MAX_INGREDIENTS, matchIngredients } from "./matcher.ts";

const roundId = z.uuid().describe("The planning round id (from the prompt).");
const day = z.iso.date().describe("YYYY-MM-DD, a local date of the request's zone.");

const SlotRef = z.object({ date: day, slot: MealSlot }).strict();

const totalsOut = (t: NutrientTotals) => ({ grams: t.grams, ...t.nutrients });

/**
 * The planning tools (#45): what a `plan` job's run (scope `plan`, its own round only) and an
 * interactive session use to fill a round. The model reads, chooses and writes; yamt computes
 * every number (`computeTotals`, the slot budget) and checks every write against the round.
 */
export function planningTools(s: Services): Tool[] {
  /** A day of the request, today or later (in its zone). */
  const checkDay = (rid: string, date: string, what: string) => {
    const { request } = roundOf(s, rid);
    const today = localDate(Date.now(), request.timeZone);
    if (date < today) throw new ToolError(`${what}: ${date} lies in the past (today is ${today})`);
  };
  /** A slot's budget on a date, in the request's zone. */
  const budgetOf = (rid: string, ref: { date: string; slot: MealSlot }) => {
    const { request } = roundOf(s, rid);
    const d = s.planning.plan({ from: ref.date, to: ref.date, tz: request.timeZone }).days[0];
    return d ? slotBudget(d, ref.slot) : null;
  };
  /** The round a food-scope tool works for: the run's own, or the one named. */
  const roundFor = (ctx: ToolContext, given: string | undefined) => {
    if (ctx.principal.kind === "plan") {
      if (given && given !== ctx.principal.roundId)
        throw new ToolError(`this run may only use planning round ${ctx.principal.roundId}`);
      return ctx.principal.roundId;
    }
    return given ?? null;
  };

  return [
    tool({
      name: "get_planning_context",
      scope: "plan",
      description:
        "Everything a planning round needs, in one call: the request (filters: days, slots, time cap, constraints, leftovers to use up, source mode, portions to cook, how many suggestions) and every input (texts, links, voice transcripts, photos and files with a local path to open; newThisRound marks a steer's), this round (and what an earlier attempt of it outlined), the earlier rounds with their suggestions and the user's verdicts (picked, rejected), each requested day (meals eaten, meals planned, open slots) with a budget per requested slot computed by yamt (a ceiling for one portion, not a target), the goal, the meals of the last 14 days with their main items (variety), leftovers and preferences.",
      schema: z.object({ roundId }),
      run({ roundId }) {
        return planningContext(s, roundId);
      },
    }),

    tool({
      name: "match_ingredients",
      scope: "food",
      description: `Ground a whole recipe's ingredient list in one call (up to ${MAX_INGREDIENTS}): for each ingredient the best food candidates, ranked (the user's history first and a strong hit there ends it, then foods yamt has cached, then USDA for generic ingredients via fdcQuery, Open Food Facts for products), each with a foodId, core numbers per 100 g, what the grams come to, state words found in its name, processed-product words, missing values and a score; warnings for a wrong state, a processed match or numbers that don't add up. Plus one portion (servings) with every first candidate, computed by yamt, and with a slot its fit to the slot's budget. The first candidate is yamt's pick: check it (right food, right state), take another, re-match the misses with better words, or use search_foods; estimate last.`,
      schema: z.object({
        ingredients: z.array(IngredientInput).min(1).max(MAX_INGREDIENTS),
        servings: z.number().int().min(1).max(50).default(1).describe("Portions the grams are for."),
        slot: SlotRef.optional().describe("The slot it is for: the fit to its budget comes back."),
        roundId: roundId
          .optional()
          .describe("The round (a planning run's own by default), for the slot's day."),
        candidates: z.number().int().min(1).max(5).default(3).describe("Candidates per ingredient."),
      }),
      async run(args, ctx) {
        const rid = roundFor(ctx, args.roundId);
        const started = Date.now();
        const { ingredients, topPicks } = await matchIngredients(s.foods, args.ingredients, {
          servings: args.servings,
          limit: args.candidates,
        });
        const budget = args.slot && rid ? budgetOf(rid, args.slot) : null;
        const portion = topPicks.nutrients;
        return {
          ingredients,
          perPortionWithFirstCandidates: totalsOut({
            grams: topPicks.grams,
            items: topPicks.items,
            nutrients: portion,
          }),
          ...(budget
            ? {
                slotBudget: budget.budget,
                fitToSlot: fitToSlot(portion, budget),
                openForTheDayAfterThis: openAfter(portion, budget),
              }
            : {}),
          ms: Date.now() - started,
          next: "Pick per ingredient (the first candidate unless it is the wrong food or state), adjust grams if the portion overshoots the budget, then save_suggestion with the foodIds.",
        };
      },
    }),

    tool({
      name: "save_round_outline",
      scope: "plan",
      description:
        "Save the round's ideas before working any out: the app shows them at once as placeholders. Exactly as many ideas as the round asks for (round.count), clearly different from each other and from recent meals and earlier rounds (dish type, main protein, cuisine, method). Each: a German title, one or two lines of approach, the source mode, a source URL if you have one already, and the day and slot it is for. Call it once, before the first save_suggestion (again only to replace the outline of a failed attempt). requestTitle: replaces the request's title when the text changed what it is for.",
      schema: z.object({
        roundId,
        ideas: z
          .array(
            z
              .object({
                title: z
                  .string()
                  .trim()
                  .min(1)
                  .max(120)
                  .describe('German, like a meal title: "Kürbis-Linsen-Dal".'),
                approach: z.string().trim().min(1).max(300).describe("One or two lines: what it is and why."),
                sourceMode: RecipeSourceMode,
                sourceUrl: z
                  .url({ protocol: /^https?$/ })
                  .max(2_000)
                  .optional(),
                proposedDate: day,
                proposedSlot: MealSlot,
              })
              .strict(),
          )
          .min(1)
          .max(MAX_SUGGESTIONS),
        requestTitle: z.string().trim().min(1).max(80).optional(),
      }),
      run(args) {
        for (const [i, idea] of args.ideas.entries())
          checkDay(args.roundId, idea.proposedDate, `ideas[${i}]`);
        const saved = s.planningRequests.saveOutline(args.roundId, {
          ideas: args.ideas,
          requestTitle: args.requestTitle ?? null,
        });
        return {
          ideas: saved.map((x) => ({
            position: x.position,
            title: x.title,
            proposedDate: x.proposedDate,
            proposedSlot: x.proposedSlot,
          })),
          next: "Now complete the ideas one at a time, in order: find or write the recipe, match_ingredients once, save_suggestion with its position.",
        };
      },
    }),

    tool({
      name: "save_suggestion",
      scope: "plan",
      description: `Save one complete suggestion as soon as it is done, then go on with the next. It becomes a recipe (validated like save_recipe: each item a foodId with grams for the whole recipe, or, only when nothing fits, an estimate) and the outline idea at \`position\` becomes ready; saving the same position again replaces it. title may replace the idea's (say so in why if the dish changed). sourceMode: "published" (as published; give the source), "adapted" (based on a real recipe; give the source and list the changes, e.g. "Sahne → Kokosmilch light"), "composed" (your own). why: up to ${MAX_WHY_LINES} short German lines, no numbers you computed yourself. yamt computes the nutrition per portion, the fit to the day and to the slot's budget, and returns them.`,
      schema: z.object({
        roundId,
        position: z
          .number()
          .int()
          .min(0)
          .max(MAX_SUGGESTIONS - 1)
          .describe("The outline idea it completes (0 = first)."),
        title: z.string().trim().min(1).max(120),
        summary: z.string().trim().max(300).default("").describe("One line that sells it."),
        why: z.array(z.string().trim().min(1).max(160)).min(1).max(MAX_WHY_LINES),
        sourceMode: RecipeSourceMode,
        sourceUrl: z
          .url({ protocol: /^https?$/ })
          .max(4_000)
          .optional(),
        sourceName: z.string().trim().max(120).optional().describe('E.g. "chefkoch.de", "Eigenes Rezept".'),
        changes: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        servings: z
          .number()
          .int()
          .min(1)
          .max(50)
          .describe("Portions the item grams are for (the portions to cook)."),
        timeActiveMin: z.number().int().min(0).max(1_440).optional(),
        timeTotalMin: z.number().int().min(0).max(10_080).describe("Total time, prep included."),
        steps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
        notes: z.string().trim().max(2_000).optional(),
        items: z.array(RecipeItemInput).min(1).max(60),
        proposedDate: day.optional().describe("Default: the idea's."),
        proposedSlot: MealSlot.optional().describe("Default: the idea's."),
      }),
      run(args) {
        if (args.proposedDate) checkDay(args.roundId, args.proposedDate, "proposedDate");
        const { request } = roundOf(s, args.roundId);
        const view = s.planningRequests.saveSuggestion(args.roundId, args.position, {
          recipe: {
            title: args.title,
            summary: args.summary,
            sourceMode: args.sourceMode,
            sourceUrl: args.sourceUrl,
            sourceName: args.sourceName,
            changes: args.changes,
            servings: args.servings,
            timeActiveMin: args.timeActiveMin,
            timeTotalMin: args.timeTotalMin,
            steps: args.steps,
            notes: args.notes,
            items: args.items,
          },
          why: args.why,
          proposedDate: args.proposedDate,
          proposedSlot: args.proposedSlot,
        });
        const perPortion = view.perPortion!;
        const budget =
          view.proposedDate && view.proposedSlot
            ? budgetOf(args.roundId, { date: view.proposedDate, slot: view.proposedSlot })
            : null;
        const round = s.repos.planningRounds.suggestions(args.roundId);
        const left = round.filter((x) => x.status === "outlined").length;
        const warnings: string[] = [];
        const cap = request.filters.timeCapMin;
        if (cap !== null && args.timeTotalMin > cap) {
          warnings.push(`takes ${args.timeTotalMin} min, the request allows ${cap}`);
        }
        const estimates = args.items.filter((i) => !i.foodId).length;
        return {
          saved: { position: view.position, suggestionId: view.id, title: view.title },
          perPortion: totalsOut(perPortion),
          ...(view.fit
            ? {
                day: {
                  date: view.fit.date,
                  slot: view.fit.slot,
                  kcalLeftWithIt: view.fit.kcalLeft,
                  proteinOpenWithIt: view.fit.proteinOpen,
                },
              }
            : {}),
          ...(budget
            ? { slotBudget: budget.budget, fitToSlot: fitToSlot(perPortion.nutrients, budget) }
            : {}),
          estimates,
          ...(warnings.length ? { warnings } : {}),
          next:
            left > 0
              ? `Go on with the next idea (${left} still outlined).`
              : "That was the last one: end the turn with one short sentence.",
        };
      },
    }),

    tool({
      name: "save_starters",
      scope: "plan",
      description: `Nightly rounds only (request.origin "nightly"): save ${MIN_STARTERS}–${MAX_STARTERS} starters, ideas the app's planning screen offers until the next night; a second call replaces the set. Each: kind (${STARTER_KINDS.join(", ")}), text (the idea as a short headline, English, dishes and produce in German: "Lachs mal wieder"), detail (one line why, from the context, no numbers you computed), filters a tap applies (when today|tomorrow|week, slots, timeCapMin, constraints, useUp texts, sourceMode, portionsCooked, count; only what the idea needs) and ref, the id it is about (mealId from recentMeals, requestId from recentRequests, recipeId; leftoverId from leftovers). Never a number in text or detail: the app computes each starter's number live from the kind and ref (protein open now, days since that meal, …).`,
      schema: z.object({
        roundId,
        starters: z.array(StarterInput).min(MIN_STARTERS).max(MAX_STARTERS),
      }),
      run({ roundId, starters }) {
        const saved = s.nightly.saveStarters(roundId, starters);
        return {
          saved: saved.map((x) => ({ position: x.position, kind: x.kind, text: x.text })),
          next: "Go on with the round's suggestions (or end the turn if they are all saved).",
        };
      },
    }),

    tool({
      name: "note_leftover",
      scope: "plan",
      description:
        'Note a remainder the user will have at home after cooking a suggestion that uses part of a pack ("½ Hokkaido", "Feta 100 g", "Kokosmilch 200 ml"), with the suggestion\'s position: it joins the leftovers list once the user has cooked that suggestion (logged its planned meal), and then the next plans use it up and the shopping list counts it as at home. Without a position (something already at home, e.g. on a fridge photo) it joins the list at once. Only real remainders of packs or pieces the recipe opens, not staples; German description like a food name ("Hokkaido", "Feta"). The same description noted again for the same suggestion replaces the earlier note (a retry). A planning run passes its roundId; an interactive session may leave it out.',
      schema: z.object({
        roundId: roundId.optional(),
        position: z
          .number()
          .int()
          .min(0)
          .max(MAX_SUGGESTIONS - 1)
          .optional()
          .describe("The outline idea whose recipe leaves it over (0 = first)."),
        description: z.string().trim().min(1).max(120).describe('What is left: "Hokkaido", "Feta".'),
        quantity: z.string().trim().max(40).optional().describe('As said: "½", "1 Stück", "1 Bund".'),
        grams: z.number().positive().max(100_000).optional().describe("About how much, when known."),
        foodId: z.uuid().optional().describe("The food it is (from match_ingredients), when known."),
        note: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe('Where it comes from: "Rest vom Kürbis-Curry (Di)".'),
      }),
      run(args, ctx) {
        if (args.roundId) {
          const { round, request } = roundOf(s, args.roundId);
          if (request.archivedAt !== null) throw new ToolError("the planning request was archived");
          if (round.status !== "running" && ctx.principal.kind === "plan")
            throw new ToolError(`the round is ${round.status}, not running`);
        }
        const { leftover, replaced } = s.leftovers.note(
          {
            position: args.position,
            description: args.description,
            quantity: args.quantity,
            grams: args.grams,
            foodId: args.foodId,
            note: args.note,
          },
          args.roundId ?? null,
        );
        return {
          leftover: {
            leftoverId: leftover.id,
            description: leftover.description,
            quantity: leftover.quantity,
            grams: leftover.grams,
          },
          replaced,
          listed: leftover.suggestionId
            ? "once the user has cooked that suggestion"
            : "now: it is on the leftovers list",
        };
      },
    }),

    tool({
      name: "fail_suggestion",
      scope: "plan",
      description:
        "Give up one idea of the outline with a short reason the user reads (German), e.g. no recipe fits the filters; then go on with the next. A ready suggestion can't fail (save it again to replace it). The round still counts if another one is ready.",
      schema: z.object({
        roundId,
        position: z
          .number()
          .int()
          .min(0)
          .max(MAX_SUGGESTIONS - 1),
        reason: z.string().trim().min(1).max(300),
      }),
      run({ roundId, position, reason }) {
        const x = s.planningRequests.failSuggestion(roundId, position, reason);
        return { failed: { position: x.position, title: x.title, reason: x.failure } };
      },
    }),
  ];
}
