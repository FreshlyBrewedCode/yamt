import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  type PlanningRequest,
  type PlanningRequestDetail,
  type PlanningRoundView,
  requestTitle,
} from "@yamt/shared";
import { cn } from "cn";
import { Archive, CalendarCheck, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Composer, Dock } from "@/components/composer";
import {
  AskedBand,
  type InputLine,
  inputLines,
  pendingLines,
  RoundRows,
  SlotsSlab,
} from "@/components/plan-request";
import { PlanForSheet } from "@/components/planning";
import { BackButton, Band, iconButtonClass, Label, SafeBottom, Strip } from "@/components/slab";
import { dateStart, dayLabel, formatTime, localDate, plural } from "@/lib/format";
import { outbox, type PlanRequestEntry, usePlanningOutbox } from "@/lib/outbox";
import { clearDraft, sendDraft } from "@/lib/plan-draft";
import { askedWords, roundMeta } from "@/lib/plan-request";
import { planError, useArchiveRequest, usePlan, usePlannedMeal, usePlanningRequest } from "@/lib/queries";

export const Route = createFileRoute("/plan/requests/$id/")({ component: RequestThread });

const open = (r: PlanningRoundView | undefined) => r?.status === "queued" || r?.status === "running";

/** "15:41" today, "Yesterday, 15:41", "Mon 3 Nov, 15:41". */
const when = (ms: number, now: number) => {
  const day = dayLabel(dateStart(localDate(ms)), now);
  return day === "Today" ? formatTime(ms) : `${day}, ${formatTime(ms)}`;
};

/**
 * A planning request's thread (#47; a push opens it): the slots slab, "You asked", each round (its
 * outline as placeholders while it runs, ready suggestions as bands, ideas that couldn't be done),
 * "You added" before a steering round, Suggest more at the end of a finished round, and the docked
 * composer to steer (or, while a round runs, to add for the next one). Polls while a round runs. A
 * request still in the upload queue shows what this phone holds.
 */
function RequestThread() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const q = usePlanningRequest(id);
  const { snapshot, entries } = usePlanningOutbox(id);
  const [change, setChange] = useState<string | null>(null);
  const changing = usePlannedMeal(change);
  const created = entries.find((e): e is PlanRequestEntry => e.type === "plan-request");
  const detail = q.data ?? null;

  if (!detail) {
    if (created) return <QueuedThread entry={created} />;
    return (
      <>
        <header className="px-5 pt-5 pb-4">
          <BackButton fallback="/plan" />
        </header>
        <main className="flex-1 px-5 py-6 font-medium text-muted-foreground" data-testid="request-missing">
          {q.isPending || !snapshot.ready ? (
            <p>Loading…</p>
          ) : q.isError ? (
            <p>{planError(q.error, "this request")}</p>
          ) : (
            <p>This request doesn't exist.</p>
          )}
        </main>
        <SafeBottom />
      </>
    );
  }

  return (
    <>
      <Thread detail={detail} onChange={setChange} onArchived={() => void navigate({ to: "/plan" })} />
      {changing.data && changing.data.status === "planned" && (
        <PlanForSheet
          planned={changing.data}
          open={change !== null}
          onClose={() => setChange(null)}
          onUnplanned={() => setChange(null)}
        />
      )}
    </>
  );
}

function Thread({
  detail,
  onChange,
  onArchived,
}: {
  detail: PlanningRequestDetail;
  onChange: (plannedMealId: string) => void;
  onArchived: () => void;
}) {
  const navigate = useNavigate();
  const now = Date.now();
  const today = localDate(now);
  const { request, rounds, inputs, transcripts } = detail;
  const f = request.filters;
  const plan = usePlan(f.days[0] ?? today, f.days.at(-1) ?? today);
  const { snapshot, entries } = usePlanningOutbox(request.id);
  const archive = useArchiveRequest();
  const archived = request.archivedAt !== null;

  const latest = rounds.at(-1);
  const roundQueued = entries.find((e) => e.type === "plan-round");
  const busy = open(latest) || (roundQueued !== undefined && !roundQueued.failed);
  const lines = inputLines(inputs, transcripts);
  const lineOf = (roundId: string | null) =>
    lines.filter((l) => inputs.find((i) => i.id === l.id)?.roundId === roundId);
  // added since the last round: the server's, then what this phone still holds
  const queuedLines = pendingLines(entries, snapshot.sending, snapshot.online);
  const added: InputLine[] = rounds.length ? [...lineOf(null), ...queuedLines] : [];
  const firstLines = rounds.length ? lineOf(rounds[0]?.id ?? "") : [...lineOf(null), ...queuedLines];
  const picked = rounds.flatMap((r) =>
    r.suggestions.flatMap((s) =>
      s.verdict === "picked" && s.fit ? [{ title: s.title, date: s.fit.date, slot: s.fit.slot }] : [],
    ),
  );
  const status = archived
    ? "Archived"
    : busy
      ? "Suggesting"
      : latest?.status === "failed"
        ? "Failed"
        : latest
          ? "Suggested"
          : "Waiting";
  const openSuggestion = (sid: string) =>
    void navigate({
      to: "/plan/requests/$id/suggestions/$suggestionId",
      params: { id: request.id, suggestionId: sid },
    });

  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <BackButton fallback="/plan" />
        <div className="min-w-0 flex-1">
          <Label className="flex items-center gap-2 text-muted-foreground" data-testid="request-status">
            Request · {busy && <span className="size-2 animate-pulse bg-current" />}
            {status}
          </Label>
          <h1 className="display mt-1 text-[36px] leading-[0.95]" data-testid="request-title">
            {request.title}
          </h1>
        </div>
        <Link to="/plan/days" className={iconButtonClass} aria-label="Plan view">
          <CalendarCheck className="size-6" strokeWidth={2.5} />
        </Link>
      </header>

      <main className="flex-1">
        {archived && (
          <Band
            tone="tint"
            className="flex items-center gap-3 px-5 py-3"
            role="status"
            data-testid="archived-band"
          >
            <p className="flex-1 font-medium text-[15px] leading-snug">
              Archived: in no list, and no round runs. Its picks stay planned.
            </p>
            <button
              type="button"
              onClick={() => archive.mutate({ id: request.id, archive: false })}
              disabled={archive.isPending}
              className="flex h-11 shrink-0 items-center gap-2 bg-foreground px-4 font-bold text-background text-xs uppercase tracking-[0.08em]"
              data-testid="unarchive"
            >
              <RotateCcw className="size-4" strokeWidth={2.5} /> Unarchive
            </button>
          </Band>
        )}
        <SlotsSlab filters={f} days={plan.data?.days} picked={picked} today={today} />
        <AskedBand
          title="You asked"
          meta={`Round 1 · ${when(request.createdAt, now)}`}
          words={askedWords(f, today)}
          lines={firstLines}
          onRetry={(eid) => void outbox.retry(eid)}
          onDiscard={(eid) => void outbox.discard(eid)}
          testId="you-asked"
        />
        {rounds.map((r, i) => (
          <section key={r.id} aria-label={`Round ${r.number}`} data-testid="round" data-status={r.status}>
            {i > 0 && r.kind === "steer" && (
              <AskedBand
                title="You added"
                meta={`Round ${r.number} · ${when(r.createdAt, now)}`}
                lines={lineOf(r.id)}
              />
            )}
            <Strip
              title={`Round ${r.number}`}
              meta={
                <span className="inline-flex items-center gap-1.5" data-testid="round-meta">
                  {open(r) && <span className="size-2 animate-pulse bg-current" />}
                  {r.kind === "more" ? `Same request · ${roundMeta(r)}` : roundMeta(r)}
                </span>
              }
            />
            {r.status === "failed" && (
              <Band tone="orange" className="px-5 py-3" role="alert" data-testid="round-failed">
                <p className="font-bold">No suggestions this round.</p>
                {r.error && <p className="mt-1 font-medium text-sm">{r.error}</p>}
                <p className="mt-1 font-medium text-sm">Try again below, or say what to change.</p>
              </Band>
            )}
            {open(r) && r.suggestions.length === 0 && (
              <p className="px-5 py-4 font-medium text-muted-foreground text-sm" data-testid="round-waiting">
                {r.status === "queued"
                  ? "Queued: starts as soon as the agent is free."
                  : "Reading your request and outlining ideas…"}
              </p>
            )}
            <RoundRows
              round={r}
              request={request}
              days={plan.data?.days}
              today={today}
              onOpen={(s) => openSuggestion(s.id)}
              onChange={onChange}
            />
            {open(r) && r.suggestions.length > 0 && (
              <p className="border-border border-t px-5 py-4 font-medium text-muted-foreground text-sm leading-snug">
                The agent completes one idea at a time: ingredients matched to real foods, the portion
                computed, its fit to the day. A push arrives when the round is done; anything you add below
                goes into the next one.
              </p>
            )}
          </section>
        ))}
        {added.length > 0 && (
          <AskedBand
            title="You added"
            meta={busy ? "for the next round" : "not asked yet"}
            lines={added}
            onRetry={(eid) => void outbox.retry(eid)}
            onDiscard={(eid) => void outbox.discard(eid)}
            testId="you-added"
          />
        )}
        {!archived && (
          <MoreRow
            request={request}
            latest={latest}
            added={added.length}
            queued={roundQueued ? { failed: roundQueued.failed, error: roundQueued.error } : null}
            online={snapshot.online}
          />
        )}
        {!archived && (
          <button
            type="button"
            onClick={() => archive.mutate({ id: request.id, archive: true }, { onSuccess: onArchived })}
            disabled={archive.isPending}
            className="flex min-h-14 w-full items-center justify-between gap-3 border-border border-t px-5 text-left outline-none active:bg-tint focus-visible:bg-tint"
            data-testid="archive"
          >
            <span>
              <span className="block font-bold uppercase tracking-[0.08em]">Archive request</span>
              <span className="block font-medium text-muted-foreground text-sm">
                {busy ? "Stops the round. " : ""}Out of your lists; picks stay planned.
              </span>
            </span>
            <Archive className="size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
          </button>
        )}
        {archive.isError && (
          <p className="bg-orange px-5 py-3 font-bold text-orange-foreground text-sm" role="alert">
            {planError(archive.error, "archiving")}
          </p>
        )}
      </main>

      {archived ? (
        <SafeBottom />
      ) : (
        <Dock>
          <Composer
            draftKey={request.id}
            placeholder={busy ? "Add more for the next round…" : "Say what to change…"}
            sendLabel={busy ? "Add for the next round" : "Steer"}
            onSend={(d) => {
              void sendDraft(outbox, d, { requestId: request.id, round: !busy }).then(() =>
                clearDraft(request.id),
              );
            }}
          />
          {!busy && latest?.status === "done" && (
            <Label className="mt-2 flex items-center justify-center gap-1.5 px-5 text-center text-muted-foreground normal-case tracking-normal">
              <Sparkles className="size-3.5 shrink-0" strokeWidth={2.5} /> Pick above, steer here, or ask for
              more: a round takes minutes.
            </Label>
          )}
        </Dock>
      )}
    </>
  );
}

/**
 * The end of a finished round: **Suggest more** (tint: the same request again), lime **Suggest with
 * what you added** while additions wait for a round, "Try again" after a failed round; quiet while a
 * round waits in the upload queue.
 */
function MoreRow({
  request,
  latest,
  added,
  queued,
  online,
}: {
  request: PlanningRequest;
  latest: PlanningRoundView | undefined;
  added: number;
  queued: { failed: boolean; error: string | null } | null;
  online: boolean;
}) {
  if (queued && !queued.failed) {
    return (
      <p
        className="border-border border-t px-5 py-4 font-medium text-muted-foreground text-sm"
        data-testid="round-queued"
      >
        {online ? "Asking for a new round…" : "A new round is asked for as soon as yamt is reachable."}
      </p>
    );
  }
  if (open(latest)) return null;
  if (!latest && added === 0) return null;
  const steer = added > 0;
  const kind = steer || !latest ? "suggest" : "more";
  return (
    <>
      {queued?.failed && (
        <p className="bg-orange px-5 py-3 font-bold text-orange-foreground text-sm" role="alert">
          Couldn't start a round: {queued.error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void outbox.requestRound(request.id, kind)}
        className={cn(
          "flex min-h-16 w-full items-center gap-3 border-border border-t px-5 text-left outline-none active:opacity-70 focus-visible:underline",
          steer ? "bg-lime text-lime-foreground" : "bg-tint",
        )}
        data-testid="suggest-more"
      >
        <Sparkles className="size-5 shrink-0" strokeWidth={2.5} />
        <span className="flex-1 font-bold uppercase tracking-[0.08em]">
          {steer ? "Suggest with it" : latest?.status === "failed" ? "Try again" : "Suggest more"}
        </span>
        <Label className={steer ? "text-lime-muted" : "text-muted-foreground"}>
          {steer ? plural(added, "addition") : `same request · ${request.filters.count} more`}
        </Label>
      </button>
    </>
  );
}

/** A request only this phone has so far: what it asked, and that it goes out when yamt is reachable. */
function QueuedThread({ entry }: { entry: PlanRequestEntry }) {
  const now = Date.now();
  const today = localDate(now);
  const { snapshot, entries } = usePlanningOutbox(entry.requestId);
  const lines = pendingLines(entries, snapshot.sending, snapshot.online);
  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <BackButton fallback="/plan" />
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground" data-testid="request-status">
            Request · {entry.failed ? "Not sent" : "On this phone"}
          </Label>
          <h1 className="display mt-1 text-[36px] leading-[0.95]" data-testid="request-title">
            {requestTitle(entry.filters)}
          </h1>
        </div>
      </header>
      <main className="flex-1">
        {entry.failed ? (
          <Band tone="orange" className="px-5 py-3" role="alert" data-testid="request-refused">
            <p className="font-bold">yamt refused this request.</p>
            <p className="mt-1 font-medium text-sm">{entry.error}</p>
            <div className="mt-2 flex gap-4">
              <button
                type="button"
                onClick={() => void outbox.retry(entry.id)}
                className="h-11 font-bold text-sm underline underline-offset-4"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => void outbox.discard(entry.id)}
                className="h-11 font-bold text-sm underline underline-offset-4"
              >
                Discard
              </button>
            </div>
          </Band>
        ) : (
          <Band tone="tint" className="px-5 py-3" role="status" data-testid="request-queued">
            <p className="font-medium text-[15px] leading-snug">
              {snapshot.online
                ? "Sending to yamt…"
                : "Kept on this phone: it goes out with what you added as soon as yamt is reachable, and the agent starts then."}
            </p>
          </Band>
        )}
        <AskedBand
          title="You asked"
          meta={`Round 1 · ${when(entry.createdAt, now)}`}
          words={askedWords(entry.filters, today)}
          lines={lines}
          onRetry={(eid) => void outbox.retry(eid)}
          onDiscard={(eid) => void outbox.discard(eid)}
          testId="you-asked"
        />
      </main>
      <SafeBottom />
    </>
  );
}
