// What the planning composer holds before it is sent (#47): the text, the attachments and, on the
// entry screen, the filters. Kept in memory for the session per composer (the entry screen's, and
// each thread's), so a trip to the filter page or a suggestion's recipe doesn't lose it. Sending
// hands everything to the upload queue (`lib/outbox`), which keeps it until the server has it.
import type { ResolvedPlanningFilters } from "@yamt/shared";
import { useCallback, useSyncExternalStore } from "react";
import type { PendingPlanningInput } from "./outbox/types";
import type { FilterDraft } from "./plan-request";

/** Something attached to the composer, not sent yet. */
export interface Attachment {
  /** Local only (becomes nothing: the queue makes the input's id when it is sent). */
  id: string;
  input: PendingPlanningInput;
  capturedAt: number;
  /** A recording's length. */
  durationMs?: number;
}

export interface ComposerDraft {
  text: string;
  attachments: Attachment[];
  /** The entry screen's filters (a thread's request has its own, fixed). */
  filters: FilterDraft;
}

/** The entry screen's composer. */
export const ENTRY_DRAFT = "entry";

const EMPTY: ComposerDraft = { text: "", attachments: [], filters: {} };
const drafts = new Map<string, ComposerDraft>();
const listeners = new Set<() => void>();

export function getDraft(key: string): ComposerDraft {
  return drafts.get(key) ?? EMPTY;
}

export function setDraft(key: string, change: (d: ComposerDraft) => ComposerDraft): void {
  drafts.set(key, change(getDraft(key)));
  for (const l of listeners) l();
}

export function clearDraft(key: string): void {
  drafts.delete(key);
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** One composer's draft and a setter. */
export function useDraft(
  key: string,
): [ComposerDraft, (change: (d: ComposerDraft) => ComposerDraft) => void] {
  const draft = useSyncExternalStore(
    subscribe,
    () => getDraft(key),
    () => EMPTY,
  );
  const set = useCallback((change: (d: ComposerDraft) => ComposerDraft) => setDraft(key, change), [key]);
  return [draft, set];
}

/** Something to send: a text or an attachment. */
export const hasContent = (d: ComposerDraft): boolean => d.text.trim() !== "" || d.attachments.length > 0;

/** The queue's side of sending (the `Outbox`; a fake in tests). */
export interface DraftQueue {
  addPlanningRequest(r: {
    requestId: string;
    filters: ResolvedPlanningFilters;
    tz: string;
    text?: string;
  }): Promise<unknown>;
  addPlanningInput(requestId: string, input: PendingPlanningInput, capturedAt?: number): Promise<unknown>;
  requestRound(requestId: string, kind: "suggest" | "more"): Promise<unknown>;
}

/**
 * Sends a draft through the upload queue, in the order the server needs: a new request (with the
 * text alone along with it) or the text as an input of an existing one, then the attachments, then
 * a round (`suggest`: the first, or a steer with what was just added) unless `round` is false (a
 * round is still open: what is added goes into the next one).
 */
export async function sendDraft(
  queue: DraftQueue,
  draft: ComposerDraft,
  to: { requestId: string; create?: { filters: ResolvedPlanningFilters; tz: string }; round: boolean },
): Promise<void> {
  const text = draft.text.trim();
  if (to.create) {
    await queue.addPlanningRequest({ requestId: to.requestId, ...to.create, ...(text ? { text } : {}) });
  } else if (text) {
    await queue.addPlanningInput(to.requestId, { kind: "text", text });
  }
  for (const a of draft.attachments) await queue.addPlanningInput(to.requestId, a.input, a.capturedAt);
  if (to.round) await queue.requestRound(to.requestId, "suggest");
}
