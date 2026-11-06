// The nightly run on the phone (#48, G's "Tonight"): the entry screen's section with today's
// nightly suggestions as compact bands (Pick · tonight / No), Regenerate and a way into the thread,
// the hint while the run is off, and the overview strip's quiet row.
import { Link, useNavigate } from "@tanstack/react-router";
import type { NightlyResponse, PlanDay, PlanningRequest, PlanningSuggestionView } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, Check, ChefHat, ChevronRight, Clock, Moon, RefreshCw, Square, X } from "lucide-react";
import { useState } from "react";
import { formatNumber, formatTime, plural } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { nightlyMeta, nightlyPickWords, nightlyRows, nightlyState, nightlyTitle } from "@/lib/nightly";
import { pickTarget } from "@/lib/plan-request";
import { sourceLabel } from "@/lib/planning";
import {
  planError,
  usePickSuggestion,
  useRegenerateNightly,
  useRejectSuggestion,
  useUnplanMeal,
} from "@/lib/queries";
import { FitBar } from "./planning";
import { Label, Strip } from "./slab";

/**
 * A nightly suggestion, compact: title, its first why-line and kcal per portion, the day's bar with
 * it, time · protein against what is open · source, then **Pick · tonight** (ink) and No. Picked:
 * tint with "Planned · tonight" and Unplan; rejected: folded with Undo. Quiet (no buttons) while a
 * regenerated round replaces it. The title opens the recipe.
 */
function NightlyRow({
  s,
  request,
  days,
  today,
  quiet,
}: {
  s: PlanningSuggestionView;
  request: PlanningRequest;
  days: readonly PlanDay[] | undefined;
  today: string;
  quiet: boolean;
}) {
  const navigate = useNavigate();
  const pick = usePickSuggestion(request.id);
  const reject = useRejectSuggestion(request.id);
  const unplan = useUnplanMeal();
  const [pickId] = useState(() => uuidv7());
  const busy = pick.isPending || reject.isPending || unplan.isPending;
  const error = pick.error ?? reject.error ?? unplan.error;

  if (s.status === "outlined") {
    return (
      <li className="px-5 py-3 text-muted-foreground" data-testid="nightly-suggestion" data-state="outlined">
        <div className="flex items-start gap-4">
          <h3 className="display min-w-0 flex-1 text-[19px] leading-[1.05] tracking-[-0.02em]">{s.title}</h3>
          <div className="display shrink-0 text-[26px]">—</div>
        </div>
        <div className="mt-2.5 h-2 w-full bg-foreground/8" aria-hidden />
        <Label className="mt-2 flex items-center gap-1.5">
          <span className="size-2 animate-pulse bg-current" /> Checking ingredients…
        </Label>
      </li>
    );
  }

  if (s.verdict === "rejected") {
    return (
      <li
        className="flex min-h-11 items-center gap-3 px-5 text-muted-foreground"
        data-testid="nightly-suggestion"
        data-state="rejected"
      >
        <X className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{s.title} · no</span>
        {!quiet && (
          <button
            type="button"
            onClick={() => reject.mutate({ suggestionId: s.id, reject: false })}
            disabled={busy}
            className="h-11 px-1 font-bold text-foreground text-sm underline underline-offset-4"
          >
            Undo
          </button>
        )}
      </li>
    );
  }

  const fit = s.fit;
  const picked = s.verdict === "picked" && s.plannedMealId;
  const target = picked && fit ? { date: fit.date, slot: fit.slot } : pickTarget(s, request, days, today);
  const per = s.perPortion?.nutrients ?? null;
  const kcalTarget = fit?.goal?.targets.energyKcal ?? null;
  const before = fit?.before?.nutrients;
  const withKcal = fit?.with.nutrients.energyKcal ?? null;
  const proteinTarget = fit?.goal?.targets.protein ?? null;
  const proteinOpen = proteinTarget === null ? null : Math.max(0, proteinTarget - (before?.protein ?? 0));
  const recipe = s.recipe;
  const where = nightlyPickWords(target, today);

  return (
    <li
      className={cn("px-5 pt-3 pb-3", picked && "bg-tint", quiet && "text-muted-foreground")}
      data-testid="nightly-suggestion"
      data-state={picked ? "picked" : "ready"}
    >
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/plan/requests/$id/suggestions/$suggestionId",
            params: { id: request.id, suggestionId: s.id },
          })
        }
        className="flex w-full items-start gap-4 text-left outline-none focus-visible:underline"
      >
        <div className="min-w-0 flex-1">
          {picked && (
            <Label className="mb-1 flex items-center gap-1.5">
              <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · {where}
            </Label>
          )}
          <h3 className="display text-[19px] leading-[1.05] tracking-[-0.02em]" data-testid="nightly-title">
            {s.title}
          </h3>
          {s.why[0] && (
            <p className="mt-1 flex items-start gap-2 font-medium text-muted-foreground text-sm leading-snug">
              <Square className="mt-1.5 size-2 shrink-0 fill-current" strokeWidth={0} />
              {s.why[0]}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="display text-[26px]">{per ? formatNumber(per.energyKcal) : "—"}</div>
          <Label className="text-[10px] text-muted-foreground">kcal</Label>
        </div>
      </button>
      {fit && kcalTarget !== null && withKcal !== null && (
        <FitBar
          base={before?.energyKcal ?? 0}
          dish={Math.max(0, withKcal - (before?.energyKcal ?? 0))}
          target={kcalTarget}
          surface={picked ? "tint" : "page"}
          className="mt-2.5 h-2"
        />
      )}
      <Label className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        {recipe?.timeTotalMin != null && (
          <>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" strokeWidth={2.5} /> {recipe.timeTotalMin} min
            </span>
            <span>·</span>
          </>
        )}
        {per && proteinOpen !== null && (
          <>
            <span className={cn(!quiet && "text-foreground")}>
              {formatNumber(per.protein)} of {formatNumber(proteinOpen)} g P
            </span>
            <span>·</span>
          </>
        )}
        {recipe && <span>{sourceLabel(recipe)}</span>}
      </Label>
      {error && (
        <p className="mt-2.5 bg-orange px-3 py-2 font-bold text-orange-foreground text-sm" role="alert">
          {planError(error, "picking")}
        </p>
      )}
      {!quiet &&
        (picked ? (
          <button
            type="button"
            onClick={() => s.plannedMealId && unplan.mutate(s.plannedMealId)}
            disabled={busy}
            className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 bg-background font-bold text-sm uppercase tracking-[0.08em] outline-none active:opacity-70 focus-visible:underline"
            data-testid="nightly-unplan"
          >
            {unplan.isPending ? "…" : "Unplan"}
          </button>
        ) : (
          <div className="mt-2.5 flex gap-0.5">
            <button
              type="button"
              onClick={() => pick.mutate({ suggestionId: s.id, body: { id: pickId } })}
              disabled={busy}
              className="flex h-11 flex-1 items-center justify-center gap-2 bg-ink font-bold text-ink-foreground text-sm uppercase tracking-[0.08em] outline-none active:opacity-80 focus-visible:underline disabled:opacity-60"
              data-testid="nightly-pick"
            >
              <Check className="size-5" strokeWidth={3} /> {pick.isPending ? "Picking…" : `Pick · ${where}`}
            </button>
            <button
              type="button"
              onClick={() => reject.mutate({ suggestionId: s.id, reject: true })}
              disabled={busy}
              className="flex h-11 w-24 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] outline-none active:opacity-70 focus-visible:underline"
              aria-label={`No: ${s.title}`}
              data-testid="nightly-reject"
            >
              <X className="size-5" strokeWidth={2.5} /> No
            </button>
          </div>
        ))}
    </li>
  );
}

/** A plain full-width row of the section: an icon, a bold caps label, a muted note on the right. */
function SectionRow({
  icon,
  label,
  note,
  disabled,
  ...props
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  disabled?: boolean;
} & Omit<React.ComponentProps<"button">, "children">) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex min-h-14 w-full items-center gap-3 border-border border-t px-5 text-left outline-none active:bg-tint focus-visible:underline disabled:text-muted-foreground"
      {...props}
    >
      {icon}
      <span className="flex-1 font-bold uppercase tracking-[0.08em]">{label}</span>
      <Label className="text-muted-foreground">{note}</Label>
    </button>
  );
}

/**
 * The entry screen's "Tonight" (or "Today") section: the nightly suggestions with Pick / No, the
 * thread (steer or ask for more there) and Regenerate (a new run now; "these stay until the new
 * ones arrive"). Without today's request: when it arrives, and Regenerate as "Suggest now". Off
 * with nothing made today: a muted hint to the settings instead.
 */
export function NightlySection({
  nightly,
  days,
  today,
}: {
  nightly: NightlyResponse;
  days: readonly PlanDay[] | undefined;
  today: string;
}) {
  const navigate = useNavigate();
  const regenerate = useRegenerateNightly();
  // one id per attempt: a retry after a lost answer gets the same request back
  const [regenId, setRegenId] = useState(() => uuidv7());
  const state = nightlyState(nightly.requests);
  const run = () =>
    regenerate.mutate(regenId, {
      onSettled: () => setRegenId(uuidv7()),
    });

  if (!state && !nightly.settings.enabled) {
    return (
      <Link
        to="/settings"
        className="flex min-h-14 w-full items-center gap-3 border-border border-b px-5 text-left text-muted-foreground outline-none active:bg-tint focus-visible:underline"
        data-testid="nightly-off"
      >
        <span className="flex-1 font-medium text-sm">Nightly suggestions for today are off.</span>
        <Label className="flex items-center gap-1">
          Settings <ChevronRight className="size-4" strokeWidth={2.5} />
        </Label>
      </Link>
    );
  }

  const error = regenerate.error && (
    <p className="bg-orange px-5 py-3 font-bold text-orange-foreground text-sm" role="alert">
      {planError(regenerate.error, "regenerating")}
    </p>
  );

  if (!state) {
    return (
      <section aria-label="Tonight" data-testid="nightly">
        <Strip
          title="Tonight"
          meta={nightly.nextRunAt ? `next at ${formatTime(nightly.nextRunAt)}` : undefined}
        />
        <p className="bg-tint px-5 pb-4 font-medium text-[15px] leading-snug">
          Suggestions for today's open meals arrive{" "}
          {nightly.nextRunAt ? `at ${formatTime(nightly.nextRunAt)}` : "tonight"}, made while you sleep.
        </p>
        {error}
        <SectionRow
          icon={<RefreshCw className="size-5 shrink-0" strokeWidth={2.5} />}
          label={regenerate.isPending ? "Starting…" : "Suggest now"}
          note="runs now"
          disabled={regenerate.isPending}
          onClick={run}
          data-testid="nightly-regenerate"
        />
      </section>
    );
  }

  const { mode, shown, newer } = state;
  const quiet = mode === "regenerating";
  const regenerating = mode === "regenerating" || (mode === "suggesting" && regenerate.isPending);
  const rows = nightlyRows(shown);
  const title = nightlyTitle(shown);
  const newerFailed = newer?.rounds.at(-1)?.status === "failed" ? newer.rounds.at(-1) : null;
  const ownFailed = mode === "failed" ? shown.rounds.at(-1) : null;

  return (
    <section aria-label={title} data-testid="nightly" data-mode={mode}>
      <Strip
        title={title}
        meta={
          quiet || mode === "suggesting" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 animate-pulse bg-current" /> {nightlyMeta(state)}
            </span>
          ) : (
            nightlyMeta(state)
          )
        }
      />
      {quiet && newer && (
        <p
          className="bg-tint px-5 pb-4 font-medium text-[15px] leading-snug"
          data-testid="nightly-regenerating"
        >
          Started {formatTime(newer.request.createdAt)}. These stay until the new ones arrive.
        </p>
      )}
      {(newerFailed || ownFailed) && (
        <p className="bg-tint px-5 pb-4 font-medium text-[15px] leading-snug">
          {newerFailed ? "Regenerating didn't work" : "No suggestions this time"}:{" "}
          {(newerFailed ?? ownFailed)?.error ?? "no reason given"}.
        </p>
      )}
      {mode === "suggesting" && rows.length === 0 && (
        <p className="bg-tint px-5 pb-4 font-medium text-[15px] leading-snug">
          Outlining today's ideas… they show here one by one.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border" data-testid="nightly-rows">
          {rows.map((s) => (
            <NightlyRow key={s.id} s={s} request={shown.request} days={days} today={today} quiet={quiet} />
          ))}
        </ul>
      )}
      {error}
      {mode !== "suggesting" && mode !== "failed" && (
        <SectionRow
          icon={<ArrowRight className="size-5 shrink-0" strokeWidth={2.5} />}
          label="Steer or ask for more"
          note="the thread"
          onClick={() => void navigate({ to: "/plan/requests/$id", params: { id: shown.request.id } })}
          data-testid="nightly-thread"
        />
      )}
      <SectionRow
        icon={
          <RefreshCw className={cn("size-5 shrink-0", regenerating && "animate-spin")} strokeWidth={2.5} />
        }
        label={regenerating ? "Regenerating…" : "Regenerate"}
        note={regenerating ? "a few minutes" : "runs now"}
        disabled={regenerating || regenerate.isPending}
        onClick={run}
        data-testid="nightly-regenerate"
      />
    </section>
  );
}

/**
 * The overview strip's nightly row: quiet (not lime: nobody asked), "Tonight · 3 suggestions",
 * their titles, when they were made; opens the entry screen.
 */
export function NightlyStripRow({
  row,
}: {
  row: { title: string; waiting: number; titles: string[]; madeAt: number };
}) {
  return (
    <li>
      <Link
        to="/plan"
        className="flex min-h-[84px] w-full items-stretch gap-4 px-5 py-3 outline-none active:bg-tint focus-visible:underline"
        data-testid="planning-row"
        data-state="nightly"
      >
        <div className="min-w-0 flex-1">
          <Label className="flex items-center gap-2 text-muted-foreground">
            <Moon className="size-3.5" strokeWidth={2.5} /> {row.title} · {plural(row.waiting, "suggestion")}
          </Label>
          <div className="display mt-1.5 truncate text-[19px] leading-[1.05] tracking-[-0.02em]">
            {row.titles.join(", ")}
          </div>
          <div className="mt-1.5 font-medium text-muted-foreground text-xs">
            Made at {formatTime(row.madeAt)}
          </div>
        </div>
        <div className="flex shrink-0 items-center text-muted-foreground">
          <ArrowRight className="size-6" strokeWidth={2.5} />
        </div>
      </Link>
    </li>
  );
}
