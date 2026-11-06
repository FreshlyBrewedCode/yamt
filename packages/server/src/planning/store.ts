import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * SPIKE #38: planning data as JSON files under `<data>/planning/`, so the driver script (another
 * process) can write a request and read what a round saved. The real thing gets tables (#36,
 * subtasks 3 and 5).
 *
 *   context.json                 leftovers and preferences
 *   rounds/<id>/request.json     the planning request of a round (text + filters, earlier rounds)
 *   rounds/<id>/outline.json     what save_round_outline saved (with the time it arrived)
 *   rounds/<id>/suggestions.json what save_suggestion saved, in order
 */

export const Slot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type Slot = z.infer<typeof Slot>;
export const SlotRef = z.object({ date: z.iso.date(), slot: Slot }).strict();
export type SlotRef = z.infer<typeof SlotRef>;

export const SourceMode = z.enum(["real", "based_on", "free"]);
export type SourceMode = z.infer<typeof SourceMode>;

export const PlanningRequest = z.object({
  text: z.string(),
  filters: z.object({
    slots: z.array(SlotRef),
    timeCapMinutes: z.number().nullable(),
    constraints: z.array(z.string()),
    useUpLeftovers: z.array(z.string()),
    sourceMode: SourceMode,
    portionsToCook: z.number().int().min(1),
    count: z.number().int().min(1).max(6),
  }),
  /** Earlier rounds of the same request (steering starts from them), oldest first. */
  previousRounds: z.array(z.string()).default([]),
  /** What the user added since the last round (steer), if anything. */
  steer: z.string().nullable().default(null),
  createdAt: z.number(),
});
export type PlanningRequest = z.infer<typeof PlanningRequest>;

export interface Leftover {
  name: string;
  amount: string;
  grams: number | null;
  since: string;
}

export interface Preferences {
  dislikes: string[];
  neverEat: string[];
  equipment: string[];
  weekdayCookingMinutes: number;
  favouriteSites: string[];
  notes: string[];
}

export interface PlanningContextFile {
  leftovers: Leftover[];
  preferences: Preferences;
}

export class PlanningStore {
  readonly dir: string;
  constructor(dataDir: string) {
    this.dir = join(dataDir, "planning");
  }

  private roundDir(roundId: string): string {
    if (!/^[\w-]{1,80}$/.test(roundId)) throw new Error(`bad round id ${roundId}`);
    return join(this.dir, "rounds", roundId);
  }

  private read<T>(path: string): T | null {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
  }

  private write(path: string, value: unknown): void {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
  }

  context(): PlanningContextFile {
    return (
      this.read<PlanningContextFile>(join(this.dir, "context.json")) ?? {
        leftovers: [],
        preferences: {
          dislikes: [],
          neverEat: [],
          equipment: [],
          weekdayCookingMinutes: 40,
          favouriteSites: [],
          notes: [],
        },
      }
    );
  }

  setContext(c: PlanningContextFile): void {
    this.write(join(this.dir, "context.json"), c);
  }

  request(roundId: string): PlanningRequest | null {
    const raw = this.read<unknown>(join(this.roundDir(roundId), "request.json"));
    return raw === null ? null : PlanningRequest.parse(raw);
  }

  setRequest(roundId: string, r: PlanningRequest): void {
    this.write(join(this.roundDir(roundId), "request.json"), r);
  }

  outline<T>(roundId: string): T | null {
    return this.read<T>(join(this.roundDir(roundId), "outline.json"));
  }

  setOutline(roundId: string, o: unknown): void {
    this.write(join(this.roundDir(roundId), "outline.json"), o);
  }

  suggestions<T>(roundId: string): T[] {
    return this.read<T[]>(join(this.roundDir(roundId), "suggestions.json")) ?? [];
  }

  addSuggestion(roundId: string, s: unknown): number {
    const list = this.suggestions<unknown>(roundId);
    list.push(s);
    this.write(join(this.roundDir(roundId), "suggestions.json"), list);
    return list.length;
  }
}
