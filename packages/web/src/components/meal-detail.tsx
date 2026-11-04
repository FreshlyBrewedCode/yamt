import { Link, useNavigate } from "@tanstack/react-router";
import {
  type Capture,
  type MealDetailResponse,
  type MealQuestionView,
  type MealStatus,
  mealPaths,
  type Transcript,
} from "@yamt/shared";
import { cn } from "cn";
import { Mic, Pause, Pencil, Play, Plus, Repeat, Square, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Recording, useRecorder } from "@/hooks/use-recorder";
import { formatDayTime, formatNumber, fromLocalInput, plural, toLocalInput } from "@/lib/format";
import {
  type CaptureEntry,
  CaptureRejected,
  type OutboxEntry,
  outbox,
  type PendingCapture,
  useMealOutbox,
} from "@/lib/outbox";
import { useUpdateMeal } from "@/lib/queries";
import { formatDuration, recordingName } from "@/lib/recorder";
import { CaptureList, useCaptureRows } from "./capture-list";
import { ItemsList } from "./items-list";
import { LogAgainSheet, type RepeatSource } from "./log-again";
import { RevisionHistory } from "./revision-history";
import { BackButton, Band, BottomSlab, Disclosure, Label, SlabButton, StatusLabel, Strip } from "./slab";
import { TotalsSlab } from "./totals-slab";
import { runMeta, TraceView } from "./trace-view";

/** What a skipped question is answered with, so the next analysis stops asking. */
export const SKIPPED_ANSWER = "No answer: keep your best estimate.";

type VoiceTarget = { kind: "answer"; questionId: string } | { kind: "correction" };

/**
 * An analysed (or failed) meal: what the agent made of it, with every number traceable.
 *
 * Header (time, editable; status; title; summary) → a failed analysis's error (orange) → the
 * numbers (the ink slab) → the agent's questions (lime: answer by text or a spoken answer
 * recorded right there, or skip) → items with provenance and confidence (low confidence
 * lime-soft; tap for the source) → what it assumed (tint) → a free correction → captures,
 * revision history and the trace, collapsed. The bottom slab is the one action: "Answer &
 * re-analyse" / "Correct & re-analyse" / "Re-analyse" / "Retry analysis" (lime) when there is
 * something for the next analysis, else "Add to this meal" (tint), which opens the capture view;
 * on an analysed meal split with "Log again" (#30), which copies it to a new meal. A meal that was
 * logged again links its source under the title and has no run to trace.
 * Answers and corrections go through the upload queue like every capture.
 */
export function MealDetail({ detail }: { detail: MealDetailResponse }) {
  const { meal, revision: view, captures, transcripts, runs } = detail;
  const mealId = meal.id;
  const navigate = useNavigate();
  const { snapshot, entries } = useMealOutbox(mealId);
  const captureEntries = useMemo(
    () => entries.filter((e): e is CaptureEntry => e.type === "capture"),
    [entries],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [correction, setCorrection] = useState("");
  const [again, setAgain] = useState<RepeatSource | null>(null);
  const hasQuestions = (view?.questions.length ?? 0) > 0;

  // a "needs input" notification links to #questions: bring the question into view once
  useEffect(() => {
    if (hasQuestions && window.location.hash === "#questions") {
      document.getElementById("questions")?.scrollIntoView({ block: "start" });
    }
  }, [hasQuestions]);

  const save = async (capture: PendingCapture, capturedAt?: number) => {
    setProblem(null);
    try {
      await outbox.addCapture(mealId, capture, capturedAt);
    } catch (e) {
      setProblem(e instanceof CaptureRejected ? e.message : `Couldn't keep that: ${(e as Error).message}`);
    }
  };

  // one recorder for spoken answers and corrections; `target` says what the recording is for
  const target = useRef<VoiceTarget | null>(null);
  const [recordingFor, setRecordingFor] = useState<VoiceTarget | null>(null);
  const recorder = useRecorder((r: Recording) => {
    const t = target.current;
    if (!t) return;
    void save(
      {
        kind: t.kind,
        blob: r.blob,
        fileName: recordingName(r.startedAt, r.mimeType),
        mimeType: r.mimeType,
        durationMs: r.durationMs,
        ...(t.kind === "answer" ? { questionId: t.questionId } : {}),
      },
      r.startedAt,
    );
  });
  useEffect(() => {
    if (!recorder.busy && recorder.state.phase !== "error") setRecordingFor(null);
  }, [recorder.busy, recorder.state.phase]);
  const speak = (t: VoiceTarget) => {
    target.current = t;
    setRecordingFor(t);
    void recorder.start();
  };

  const rows = useCaptureRows(mealId, detail, captureEntries, snapshot, setProblem);
  const live = captures.filter((c) => c.retractedAt === null);
  const revisionAt = view?.revision.createdAt ?? null;
  const newSince = revisionAt === null ? 0 : live.filter((c) => c.createdAt > revisionAt).length;
  const pendingCaptures = captureEntries.length;
  const refused = captureEntries.filter((e) => e.failed).length;

  const questions = view?.questions ?? [];
  const answered = answeredQuestions(questions, live, captureEntries);
  const draftAnswers = questions.filter(
    (q) => !answered.has(q.id) && (answers[q.id]?.trim() || skipped.has(q.id)),
  );
  const draftCorrection = correction.trim();
  const busy = meal.status === "queued" || meal.status === "analysing";

  const submit = async () => {
    setProblem(null);
    try {
      for (const q of draftAnswers) {
        const text = answers[q.id]?.trim() || SKIPPED_ANSWER;
        await outbox.addCapture(mealId, { kind: "answer", text, questionId: q.id });
      }
      if (draftCorrection) await outbox.addCapture(mealId, { kind: "correction", text: draftCorrection });
      await outbox.requestAnalyse(mealId);
      setAnswers({});
      setSkipped(new Set());
      setCorrection("");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setProblem(`Couldn't queue that: ${(e as Error).message}`);
    }
  };

  const latestRun = runs[0] ?? null;
  const traceRun = (view?.revision.runId && runs.find((r) => r.id === view.revision.runId)) || latestRun;
  const estimated = view ? estimatedShare(view.totals) : null;
  // a finished analysis (not preliminary) can be logged again
  const repeatable =
    view && meal.status === "analysed" && view.revision.status === "analysed"
      ? {
          mealId,
          title: view.revision.title,
          eatenAt: meal.eatenAt,
          kcal: view.totals.nutrients.energyKcal,
        }
      : null;

  return (
    <>
      <DetailHeader detail={detail} />

      <main className="flex-1">
        {meal.status === "failed" && <FailedBand error={meal.analysisError} hasRevision={view !== null} />}

        {view && (
          <TotalsSlab
            totals={view.totals}
            label={busy ? "kcal · updating" : meal.status === "needs_input" ? "kcal · preliminary" : "kcal"}
            aside={
              estimated !== null && (
                <>
                  <div className="display text-[26px]" data-testid="estimated-share">
                    {estimated}%
                  </div>
                  <Label className="mt-1 text-ink-muted">estimated</Label>
                </>
              )
            }
            data-testid="meal-totals"
          />
        )}

        {questions.length > 0 && (
          <Band
            tone={meal.status === "needs_input" ? "lime" : "tint"}
            className="px-5 pt-4 pb-5"
            id="questions"
            data-testid="questions"
          >
            <Label className={meal.status === "needs_input" ? "text-lime-muted" : "text-muted-foreground"}>
              {plural(questions.length, "question")}
              {meal.status !== "needs_input" && " · answered"}
            </Label>
            <div className="divide-y divide-current/15">
              {questions.map((q) => (
                <QuestionBlock
                  key={q.id}
                  question={q}
                  open={meal.status === "needs_input" && !answered.has(q.id)}
                  lime={meal.status === "needs_input"}
                  answerCaptures={answerRows(q.id, live, transcripts, captureEntries, snapshot)}
                  draft={answers[q.id] ?? ""}
                  onDraft={(text) => setAnswers((a) => ({ ...a, [q.id]: text }))}
                  skipped={skipped.has(q.id)}
                  onSkip={(skip) =>
                    setSkipped((s) => {
                      const next = new Set(s);
                      if (skip) next.add(q.id);
                      else next.delete(q.id);
                      return next;
                    })
                  }
                  recording={recordingFor?.kind === "answer" && recordingFor.questionId === q.id}
                  recorder={recorder}
                  canSpeak={!recorder.busy}
                  onSpeak={() => speak({ kind: "answer", questionId: q.id })}
                  onRemove={(row) => removeRow(row, rows)}
                />
              ))}
            </div>
          </Band>
        )}

        {problem && (
          <Band tone="orange" className="flex items-center gap-3 px-5 py-3" role="alert">
            <p className="flex-1 font-bold text-sm">{problem}</p>
            <button
              type="button"
              onClick={() => setProblem(null)}
              aria-label="Dismiss"
              className="flex size-11 items-center justify-center"
            >
              <X className="size-5" strokeWidth={2.5} />
            </button>
          </Band>
        )}

        {view && (
          <>
            <Strip title="Items" meta="g · kcal" />
            <ItemsList items={view.items} />
            {view.revision.assumptions.length > 0 && (
              <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="assumptions">
                <h2 className="display text-[22px]">Assumed</h2>
                <ul className="mt-3 space-y-2 font-medium">
                  {view.revision.assumptions.map((a) => (
                    <li key={a} className="flex gap-3">
                      <span className="mt-2 size-2 shrink-0 bg-foreground" />
                      {a}
                    </li>
                  ))}
                </ul>
              </Band>
            )}
          </>
        )}

        <CorrectionBand
          analysed={view !== null}
          value={correction}
          onChange={setCorrection}
          recording={recordingFor?.kind === "correction"}
          recorder={recorder}
          canSpeak={!recorder.busy}
          onSpeak={() => speak({ kind: "correction" })}
          pending={correctionRows(live, revisionAt, transcripts, captureEntries, snapshot)}
          onRemove={(row) => removeRow(row, rows)}
        />

        <Disclosure title="Captures" meta={live.length + pendingCaptures} data-testid="captures">
          {rows.length > 0 && <CaptureList rows={rows} />}
          <Link
            to="/meals/$mealId"
            params={{ mealId }}
            search={{ add: true }}
            className="flex min-h-14 items-center gap-3 border-border border-t px-5 font-bold"
          >
            <Plus className="size-5" strokeWidth={2.5} /> Add photo, memo, note or link
          </Link>
        </Disclosure>
        {view && (
          <Disclosure title="Revisions" meta={view.revision.number} data-testid="revisions-section">
            <RevisionHistory mealId={mealId} captures={captures} runs={runs} currentId={view.revision.id} />
          </Disclosure>
        )}
        {traceRun ? (
          <Disclosure title="Trace" meta={runMeta(traceRun)} data-testid="trace-section">
            <TraceView run={traceRun} />
          </Disclosure>
        ) : (
          view?.revision.kind === "copy" && (
            <Disclosure title="Trace" meta="no analysis" data-testid="trace-section">
              <p className="bg-tint px-5 py-4 font-medium text-sm" data-testid="no-analysis">
                Nothing was analysed: this meal was logged again from {detail.source?.title ?? "another meal"}
                , and its items were copied from there. Add something to it and re-analyse to have it
                analysed.
              </p>
            </Disclosure>
          )
        )}
      </main>

      <DetailSlab
        status={meal.status}
        analyseQueued={entries.some((e: OutboxEntry) => e.type === "analyse")}
        pendingCaptures={pendingCaptures}
        refused={refused}
        online={snapshot.online}
        recording={recorder.busy}
        answers={
          draftAnswers.length +
          live.filter((c) => c.kind === "answer" && revisionAt !== null && c.createdAt > revisionAt).length +
          captureEntries.filter((e) => e.capture.kind === "answer").length
        }
        openQuestions={questions.filter((q) => !answered.has(q.id)).length - draftAnswers.length}
        correction={draftCorrection !== ""}
        newCaptures={newSince + pendingCaptures}
        onSubmit={() => void submit()}
        onAdd={() => navigate({ to: "/meals/$mealId", params: { mealId }, search: { add: true } })}
        onLogAgain={repeatable ? () => setAgain(repeatable) : undefined}
      />
      <LogAgainSheet
        source={again}
        onClose={() => setAgain(null)}
        onLogged={({ meal: copy }) => {
          setAgain(null);
          void navigate({ to: "/meals/$mealId", params: { mealId: copy.id } });
        }}
      />
    </>
  );

  function removeRow(key: string, all: typeof rows) {
    all.find((r) => r.key === key)?.onRemove?.();
  }
}

/** The share of kcal that are the agent's estimates (not weighed, from a label or a database). */
function estimatedShare(totals: NonNullable<MealDetailResponse["revision"]>["totals"]): number | null {
  const all = totals.nutrients.energyKcal;
  if (all <= 0) return null;
  return Math.round((totals.byProvenance.estimate.nutrients.energyKcal / all) * 100);
}

/** Questions with a live answer: on the server, or still in the upload queue. */
function answeredQuestions(
  questions: MealQuestionView[],
  live: Capture[],
  entries: CaptureEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const q of questions) if (q.answeredByCaptureId) ids.add(q.id);
  for (const c of live) if (c.kind === "answer" && c.questionId) ids.add(c.questionId);
  for (const e of entries)
    if (e.capture.kind === "answer" && e.capture.questionId) ids.add(e.capture.questionId);
  return ids;
}

/** An answer or correction shown in place: typed or spoken, on the server or still on the phone. */
interface ReplyRow {
  key: string;
  text: string | null;
  /** Spoken: its audio, its length, and how far the transcript is. */
  src: string | null;
  durationMs: number | null;
  status: string | null;
}

function replyOf(c: Capture, transcripts: Transcript[]): ReplyRow {
  if (c.mimeType === null) return { key: c.id, text: c.text, src: null, durationMs: null, status: null };
  const t = transcripts.find((x) => x.captureId === c.id);
  return {
    key: c.id,
    text: t?.status === "done" ? t.text?.trim() || "(no speech heard)" : null,
    src: mealPaths.media(c.id),
    durationMs: t?.durationMs ?? null,
    status: t?.status === "failed" ? "Transcription failed" : t?.status === "done" ? null : "Transcribing…",
  };
}

function replyOfEntry(e: CaptureEntry, snapshot: { sending: string | null; online: boolean }): ReplyRow {
  const c = e.capture;
  const status = e.failed
    ? `Refused: ${e.error ?? "unknown error"}`
    : snapshot.sending === e.id
      ? "Sending…"
      : snapshot.online
        ? "Queued"
        : "Waiting for network";
  if ("blob" in c) return { key: e.id, text: null, src: null, durationMs: c.durationMs ?? null, status };
  return { key: e.id, text: "text" in c ? (c.text ?? null) : null, src: null, durationMs: null, status };
}

function answerRows(
  questionId: string,
  live: Capture[],
  transcripts: Transcript[],
  entries: CaptureEntry[],
  snapshot: { sending: string | null; online: boolean },
): ReplyRow[] {
  const ids = new Set(live.map((c) => c.id));
  return [
    ...live
      .filter((c) => c.kind === "answer" && c.questionId === questionId)
      .map((c) => replyOf(c, transcripts)),
    ...entries
      .filter((e) => !ids.has(e.id) && e.capture.kind === "answer" && e.capture.questionId === questionId)
      .map((e) => replyOfEntry(e, snapshot)),
  ];
}

/** Corrections since the current revision: what the next analysis will read. */
function correctionRows(
  live: Capture[],
  since: number | null,
  transcripts: Transcript[],
  entries: CaptureEntry[],
  snapshot: { sending: string | null; online: boolean },
): ReplyRow[] {
  const ids = new Set(live.map((c) => c.id));
  return [
    ...live
      .filter((c) => c.kind === "correction" && (since === null || c.createdAt > since))
      .map((c) => replyOf(c, transcripts)),
    ...entries
      .filter((e) => !ids.has(e.id) && e.capture.kind === "correction")
      .map((e) => replyOfEntry(e, snapshot)),
  ];
}

function DetailHeader({ detail }: { detail: MealDetailResponse }) {
  const { meal, revision: view, source } = detail;
  const [editing, setEditing] = useState(false);
  const status = meal.status;
  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <StatusLabel
            status={status}
            className={cn(
              "h-8 px-2.5",
              status === "needs_input" && "bg-lime text-lime-foreground",
              status === "failed" && "bg-orange text-orange-foreground",
            )}
          />
        </div>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
          aria-label="Change when it was eaten"
          className="-my-2 mt-2 flex min-h-11 items-center gap-2 text-muted-foreground outline-none focus-visible:underline"
          data-testid="eaten-at"
        >
          <Label>{formatDayTime(meal.eatenAt)}</Label>
          <Pencil className="size-3.5" strokeWidth={2.5} />
        </button>
        <h1 className="display mt-1 text-[32px] leading-[0.95]" data-testid="meal-title">
          {view?.revision.title ?? "Untitled meal"}
        </h1>
        {view?.revision.summary && (
          <p className="mt-2 font-medium text-muted-foreground" data-testid="meal-summary">
            {view.revision.summary}
          </p>
        )}
        {source && (
          <Link
            to="/meals/$mealId"
            params={{ mealId: source.mealId }}
            className="-mb-2 mt-1 flex min-h-11 items-center gap-2 font-medium text-muted-foreground text-sm outline-none focus-visible:underline"
            data-testid="logged-again-from"
          >
            <Repeat className="size-4 shrink-0" strokeWidth={2.5} />
            <span className="min-w-0">
              Logged again from{" "}
              <span className="font-bold text-foreground underline underline-offset-4">
                {source.title ?? "Untitled meal"}
              </span>{" "}
              · {formatDayTime(source.eatenAt)}
            </span>
          </Link>
        )}
      </header>
      {editing && <EatenAtEditor meal={meal} onDone={() => setEditing(false)} />}
    </>
  );
}

const sourceNote: Record<MealDetailResponse["meal"]["eatenAtSource"], string> = {
  created: "When the meal was started.",
  capture: "From the first capture.",
  agent: "Worked out by the analysis from what you said.",
  user: "Set by you: captures and analyses leave it alone.",
};

/** Change when the meal was eaten (pins it), or let the captures decide again. */
function EatenAtEditor({ meal, onDone }: { meal: MealDetailResponse["meal"]; onDone: () => void }) {
  const [value, setValue] = useState(() => toLocalInput(meal.eatenAt));
  const update = useUpdateMeal(meal.id);
  const at = fromLocalInput(value);
  return (
    <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="eaten-at-editor">
      <Label className="text-muted-foreground">Eaten at</Label>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-2 h-12 w-full bg-background px-3 font-bold text-lg outline-none focus:bg-lime-soft"
        aria-label="Eaten at"
      />
      <p className="mt-2 font-medium text-muted-foreground text-sm">{sourceNote[meal.eatenAtSource]}</p>
      {update.isError && <p className="mt-2 font-bold text-sm">Couldn't save: {update.error.message}</p>}
      <div className="mt-3 flex gap-3">
        <SlabButton
          tone="ink"
          className="h-12 flex-1 text-base"
          disabled={at === null || update.isPending}
          onClick={() => at !== null && update.mutate({ eatenAt: at }, { onSuccess: onDone })}
        >
          Save
        </SlabButton>
        {meal.eatenAtSource === "user" && (
          <SlabButton
            tone="ghost"
            className="h-12 w-auto px-2 text-sm underline underline-offset-4"
            onClick={() => update.mutate({ eatenAt: null }, { onSuccess: onDone })}
          >
            Use capture time
          </SlabButton>
        )}
        <SlabButton
          tone="ghost"
          className="h-12 w-auto px-2 text-sm underline underline-offset-4"
          onClick={onDone}
        >
          Cancel
        </SlabButton>
      </div>
    </Band>
  );
}

function FailedBand({ error, hasRevision }: { error: string | null; hasRevision: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <Band tone="orange" className="px-5 pt-4 pb-5" role="alert" data-testid="failed">
      <Label className="text-orange-muted">Analysis failed</Label>
      <button type="button" onClick={() => setAll(!all)} className="mt-2 block text-left">
        <p className={cn("break-words font-bold", !all && "line-clamp-4")}>
          {error ?? "The analysis didn't finish."}
        </p>
      </button>
      <p className="mt-2 font-medium text-sm">
        {hasRevision ? "The numbers below are from the last analysis. " : ""}Add what might help, then retry
        below.
      </p>
    </Band>
  );
}

type RecorderApi = ReturnType<typeof useRecorder>;

/** One question: what and why, then its answer (typed, spoken, or skipped). */
function QuestionBlock(props: {
  question: MealQuestionView;
  /** Still wants an answer (the meal needs input and none was given yet). */
  open: boolean;
  lime: boolean;
  answerCaptures: ReplyRow[];
  draft: string;
  onDraft: (text: string) => void;
  skipped: boolean;
  onSkip: (skip: boolean) => void;
  recording: boolean;
  recorder: RecorderApi;
  canSpeak: boolean;
  onSpeak: () => void;
  onRemove: (key: string) => void;
}) {
  const { question: q, open, lime } = props;
  const muted = lime ? "text-lime-muted" : "text-muted-foreground";
  return (
    <div className="py-3 first:pt-2 last:pb-0" data-testid="question" data-open={open}>
      <p className="display text-[22px] leading-[1.1] tracking-[-0.02em]">{q.question}</p>
      <p className={cn("mt-1.5 font-medium text-sm", muted)}>
        {q.whyItMatters}{" "}
        <span className="whitespace-nowrap font-bold">±{formatNumber(q.impactKcal)} kcal</span>
      </p>
      {props.answerCaptures.length > 0 ? (
        <Replies rows={props.answerCaptures} label="Your answer" lime={lime} onRemove={props.onRemove} />
      ) : !open ? null : props.recording ? (
        <RecordingStrip recorder={props.recorder} what="answer" lime />
      ) : props.skipped ? (
        <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
          <p className="font-bold">Skipped: the analysis keeps its estimate.</p>
          <button
            type="button"
            onClick={() => props.onSkip(false)}
            className="h-11 font-bold underline underline-offset-4"
          >
            Undo
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={props.draft}
            onChange={(e) => props.onDraft(e.target.value)}
            placeholder="Type your answer…"
            rows={2}
            aria-label={`Answer: ${q.question}`}
            className="mt-3 min-h-14 w-full resize-none bg-background p-3 font-medium text-base text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-lime-foreground"
          />
          <div className="mt-3 flex items-center gap-3">
            {/* ink inside lime stays true black (lime-foreground), in dark mode too */}
            <button
              type="button"
              disabled={!props.canSpeak}
              onClick={props.onSpeak}
              className="flex h-14 flex-1 items-center justify-center gap-2 bg-lime-foreground font-bold text-base text-ink-foreground uppercase tracking-wide outline-none focus-visible:ring-4 focus-visible:ring-lime-foreground/40 active:opacity-80 disabled:opacity-60"
            >
              <Mic className="size-5" strokeWidth={2.5} /> Speak answer
            </button>
            <SlabButton
              tone="ghost"
              className="h-14 w-24 text-base underline underline-offset-4"
              onClick={() => props.onSkip(true)}
            >
              Skip
            </SlabButton>
          </div>
        </>
      )}
    </div>
  );
}

/** The free correction: "it was 2 eggs, not 3", typed or spoken. */
function CorrectionBand(props: {
  /** There is an analysis to correct (else this helps a failed first one). */
  analysed: boolean;
  value: string;
  onChange: (text: string) => void;
  recording: boolean;
  recorder: RecorderApi;
  canSpeak: boolean;
  onSpeak: () => void;
  pending: ReplyRow[];
  onRemove: (key: string) => void;
}) {
  return (
    <Band className="px-5 pt-4 pb-5" data-testid="correction">
      <h2 className="display text-[22px]">{props.analysed ? "Something off?" : "Help the analysis"}</h2>
      <p className="mt-1 font-medium text-muted-foreground text-sm">
        {props.analysed
          ? "Say what's wrong, like “it was 2 eggs, not 3”. The next analysis takes your word for it."
          : "Tell it what it should know, then retry below."}
      </p>
      {props.pending.length > 0 && (
        <Replies rows={props.pending} label="For the next analysis" lime={false} onRemove={props.onRemove} />
      )}
      {props.recording ? (
        <RecordingStrip recorder={props.recorder} what="correction" lime={false} />
      ) : (
        <div className="mt-3 flex items-stretch gap-2">
          <textarea
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder="Your correction…"
            rows={2}
            aria-label="Correction"
            className="min-h-14 flex-1 resize-none bg-tint p-3 font-medium text-base outline-none placeholder:text-muted-foreground focus:bg-lime-soft"
          />
          <button
            type="button"
            onClick={props.onSpeak}
            disabled={!props.canSpeak}
            aria-label="Speak a correction"
            className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 bg-tint font-bold text-[10px] uppercase tracking-[0.08em] active:bg-lime active:text-lime-foreground disabled:text-muted-foreground"
          >
            <Mic className="size-6" strokeWidth={2.5} />
            Speak
          </button>
        </div>
      )}
    </Band>
  );
}

/** A recording in progress, in place: stop, the time, a small level meter. */
function RecordingStrip({ recorder, what, lime }: { recorder: RecorderApi; what: string; lime: boolean }) {
  const { state, elapsedMs, levels, stop } = recorder;
  return (
    <div className="mt-3 flex items-center gap-4" data-testid="recording">
      <button
        type="button"
        onClick={stop}
        disabled={state.phase !== "recording"}
        aria-label={`Stop the spoken ${what}`}
        className={cn(
          "flex size-14 shrink-0 items-center justify-center",
          lime ? "bg-lime-foreground text-lime" : "bg-lime text-lime-foreground",
        )}
      >
        <Square className="size-6 fill-current" />
      </button>
      <div className="min-w-0 flex-1">
        <Label className={lime ? "text-lime-muted" : "text-muted-foreground"}>
          {state.phase === "requesting"
            ? "Starting…"
            : state.phase === "stopping"
              ? "Saving"
              : `Recording ${what}`}
        </Label>
        <div className="flex items-end gap-3">
          <span className="display text-[32px]" role="timer">
            {formatDuration(elapsedMs)}
          </span>
          <span className="mb-1.5 flex h-6 flex-1 items-end gap-0.5" aria-hidden>
            {levels.slice(-14).map((l, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots of the meter
                key={i}
                className="flex-1 bg-current"
                style={{ height: `${Math.max(3, Math.round(l * 24))}px` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Answers or corrections in place: the text, or a spoken one with playback and its transcript. */
function Replies({
  rows,
  label,
  lime,
  onRemove,
}: {
  rows: ReplyRow[];
  label: string;
  lime: boolean;
  onRemove: (key: string) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const toggle = (r: ReplyRow) => {
    const el = audio.current;
    if (!el || !r.src) return;
    if (playing === r.key) {
      el.pause();
      return;
    }
    el.src = r.src;
    void el.play().then(
      () => setPlaying(r.key),
      () => setPlaying(null),
    );
  };
  return (
    <div className="mt-3" data-testid="replies">
      {/* biome-ignore lint/a11y/useMediaCaption: spoken answers; the transcript is the caption */}
      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} hidden />
      <Label className={lime ? "text-lime-muted" : "text-muted-foreground"}>{label}</Label>
      <ul className="mt-1 space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3" data-testid="reply">
            {r.src && (
              <button
                type="button"
                onClick={() => toggle(r)}
                aria-label={playing === r.key ? "Pause" : "Play"}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center",
                  lime ? "bg-lime-foreground text-lime" : "bg-tint",
                )}
              >
                {playing === r.key ? (
                  <Pause className="size-5 fill-current" />
                ) : (
                  <Play className="size-5" strokeWidth={2.5} />
                )}
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="break-words font-bold">
                {r.text
                  ? `“${r.text}”`
                  : `Spoken${r.durationMs !== null ? ` · ${formatDuration(r.durationMs)}` : ""}`}
              </p>
              {r.status && (
                <Label className={lime ? "text-lime-muted" : "text-muted-foreground"}>{r.status}</Label>
              )}
            </div>
            {confirm === r.key ? (
              <button
                type="button"
                onClick={() => onRemove(r.key)}
                className="h-11 bg-foreground px-3 font-bold text-background text-xs uppercase tracking-[0.08em]"
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(r.key)}
                aria-label="Remove"
                className={cn(
                  "-mr-2 flex size-11 items-center justify-center",
                  lime ? "text-lime-muted" : "text-muted-foreground",
                )}
              >
                <X className="size-5" strokeWidth={2.5} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The one action at the bottom: send what the user gave for a new analysis, or add more. */
function DetailSlab(props: {
  status: MealStatus;
  analyseQueued: boolean;
  pendingCaptures: number;
  refused: number;
  online: boolean;
  recording: boolean;
  /** Answers for the next analysis: typed or skipped here, or spoken and already queued. */
  answers: number;
  /** Questions still without an answer, a draft or a skip. */
  openQuestions: number;
  correction: boolean;
  newCaptures: number;
  onSubmit: () => void;
  onAdd: () => void;
  /** An analysed meal can be logged again (#30): the calm slab offers it beside adding. */
  onLogAgain?: () => void;
}) {
  const { status, pendingCaptures, refused } = props;
  if (props.analyseQueued) {
    const hint =
      refused > 0
        ? "An upload was refused: retry or remove it, then the analysis starts."
        : pendingCaptures > 0
          ? `The analysis starts when ${plural(pendingCaptures, "upload")} ${pendingCaptures === 1 ? "is" : "are"} up.`
          : props.online
            ? "Sending…"
            : "Waiting for the network.";
    return (
      <BottomSlab hint={hint}>
        <SlabButton disabled>
          <Zap className="size-7" strokeWidth={2.5} /> Analyse queued
        </SlabButton>
      </BottomSlab>
    );
  }
  if (status === "queued" || status === "analysing") {
    return (
      <BottomSlab hint="The numbers update when it's done.">
        <SlabButton disabled data-testid="detail-slab">
          <span className="size-3 animate-pulse bg-current" /> {status === "queued" ? "Queued" : "Analysing…"}
        </SlabButton>
      </BottomSlab>
    );
  }
  const something = props.answers > 0 || props.correction || props.newCaptures > 0;
  if (!something && status === "needs_input" && props.openQuestions > 0) {
    return (
      <BottomSlab hint={`Answer or skip the ${props.openQuestions === 1 ? "question" : "questions"} above.`}>
        <SlabButton disabled data-testid="detail-slab">
          <Zap className="size-7" strokeWidth={2.5} /> Answer & re-analyse
        </SlabButton>
      </BottomSlab>
    );
  }
  if (!something && status !== "failed" && props.onLogAgain) {
    // two quiet halves, like the day view's steps: neither wants the user
    const half =
      "h-[76px] gap-2 px-3 text-lg enabled:active:bg-lime enabled:active:text-lime-foreground enabled:active:opacity-100";
    return (
      <BottomSlab>
        <Band tone="tint" className="grid grid-cols-2 divide-x divide-border">
          <SlabButton tone="tint" className={half} onClick={props.onAdd} data-testid="detail-slab">
            <Plus className="size-6 shrink-0" strokeWidth={2.5} /> Add more
          </SlabButton>
          <SlabButton tone="tint" className={half} onClick={props.onLogAgain} data-testid="log-again-button">
            <Repeat className="size-6 shrink-0" strokeWidth={2.5} /> Log again
          </SlabButton>
        </Band>
      </BottomSlab>
    );
  }
  if (!something && status !== "failed") {
    return (
      <BottomSlab>
        <SlabButton tone="tint" onClick={props.onAdd} data-testid="detail-slab">
          <Plus className="size-7" strokeWidth={2.5} /> Add to this meal
        </SlabButton>
      </BottomSlab>
    );
  }
  const label =
    props.answers > 0
      ? "Answer & re-analyse"
      : props.correction
        ? "Correct & re-analyse"
        : status === "failed" && props.newCaptures === 0
          ? "Retry analysis"
          : "Re-analyse";
  const going = pendingCaptures - refused;
  const hint = props.recording
    ? "Stop the recording first."
    : refused > 0
      ? `${plural(refused, "upload")} refused: retry or remove ${refused === 1 ? "it" : "them"} first.`
      : going > 0
        ? `${plural(going, "upload")} still going. The analysis waits for them.`
        : undefined;
  return (
    <BottomSlab hint={hint}>
      <SlabButton
        disabled={props.recording || refused > 0}
        onClick={props.onSubmit}
        data-testid="detail-slab"
      >
        <Zap className="size-7 fill-current" strokeWidth={2.5} /> {label}
      </SlabButton>
    </BottomSlab>
  );
}
