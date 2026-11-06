import type { PlanningRequest, PlanningRound, PlanningSuggestion } from "@yamt/shared";
import type * as acp from "../acp/protocol.ts";
import { type AgentPhoto, MAX_ATTACHED_PHOTOS } from "../analysis/prompt.ts";

export interface PlanPromptInput {
  request: PlanningRequest;
  round: PlanningRound;
  /** This job's attempt (1, 2, …) and how many it gets. */
  attempt: number;
  maxAttempts: number;
  /** The round's outline so far: an earlier attempt's, or one a server stop interrupted. */
  outline: PlanningSuggestion[];
  /** The request's photo inputs. */
  photos: AgentPhoto[];
  /** Voice inputs whose transcription failed. */
  failedTranscripts: { inputId: string; error: string | null }[];
}

/**
 * A plan job's prompt: which round of which request, what kind of round, where an earlier
 * attempt left it, and the request's photos (as image blocks when the harness takes them, else
 * their paths). Everything else the agent reads with `get_planning_context`; how it plans is the
 * plan-meals skill's.
 */
export async function buildPlanPrompt(
  input: PlanPromptInput,
  capabilities: acp.AgentCapabilities,
): Promise<acp.ContentBlock[]> {
  const { request, round } = input;
  const images = capabilities.promptCapabilities?.image === true;
  const showable = input.photos.filter((p) => p.path !== null);
  const attached: { photo: AgentPhoto; data: string }[] = [];
  if (images) {
    for (const photo of showable) {
      if (attached.length >= MAX_ATTACHED_PHOTOS) break;
      if (photo.mimeType !== "image/jpeg") continue;
      attached.push({ photo, data: Buffer.from(await Bun.file(photo.path!).bytes()).toString("base64") });
    }
  }
  const listed = showable.filter((p) => !attached.some((a) => a.photo === p));
  const ready = input.outline.filter((x) => x.status === "ready");
  const open = input.outline.filter((x) => x.status === "outlined");

  const lines = [
    `Planning round ${round.id}: round ${round.number} of the planning request "${request.title}", attempt ${input.attempt} of ${input.maxAttempts}. Suggest ${round.count} ${round.count === 1 ? "meal" : "meals"}, following the plan-meals instructions.`,
    "",
    `- Start with get_planning_context (roundId "${round.id}"): the request with its filters and inputs, the earlier rounds and the user's verdicts, each day with its slot budgets, the goal, the recent meals.`,
  ];
  if (round.kind === "steer") {
    lines.push(
      "- This round steers: the inputs marked newThisRound are what the user added since the last round. Start from the earlier rounds, keep what the new input doesn't object to and change what it asks for.",
    );
  } else if (round.kind === "more") {
    lines.push(
      "- The user asked for more with the same input: suggest different dishes than the earlier rounds did, and none they rejected.",
    );
  }
  if (ready.length > 0) {
    lines.push(
      `- This round was interrupted after ${ready.length} of its suggestions were saved: keep its outline (don't save a new one) and complete the ideas still outlined, at positions ${open.map((x) => x.position).join(", ") || "none"}.`,
    );
  } else if (input.outline.length > 0) {
    lines.push(
      "- An earlier attempt of this round saved an outline but no suggestion: save the outline again (it replaces the old one), then complete it.",
    );
  } else {
    lines.push(`- Then save_round_outline with exactly ${round.count} ideas before working any out.`);
  }
  lines.push(
    "- Then complete the ideas one at a time, in order: find or write the recipe, match its ingredients with one match_ingredients call, save_suggestion with its position. Save each as soon as it is done; fail_suggestion one that can't be done, then go on.",
  );
  if (attached.length) {
    lines.push(
      `- ${attached.length === 1 ? "One photo" : `${attached.length} photos`} of the request ${attached.length === 1 ? "is" : "are"} attached below, each after a line with its input id.`,
    );
  }
  if (listed.length) {
    lines.push(
      `- ${attached.length ? "More photos" : "Photos"} of the request, to open with your file-reading tool:`,
      ...listed.map((p) => `  - input ${p.captureId}: ${p.path}`),
    );
  }
  for (const p of input.photos.filter((x) => x.path === null)) {
    lines.push(`- Photo ${p.captureId} can't be shown (${p.problem}); work from the other inputs.`);
  }
  for (const t of input.failedTranscripts) {
    lines.push(
      `- Voice input ${t.inputId} could not be transcribed${t.error ? ` (${t.error})` : ""}: work from the other inputs.`,
    );
  }
  lines.push("- Nobody answers during the run: decide, don't ask. yamt computes every number.");

  const blocks: acp.ContentBlock[] = [{ type: "text", text: lines.join("\n") }];
  for (const { photo, data } of attached) {
    blocks.push({ type: "text", text: `Photo input ${photo.captureId}:` });
    blocks.push({ type: "image", mimeType: "image/jpeg", data });
  }
  return blocks;
}
