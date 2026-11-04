import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { MealDetailResponse, MealStatus } from "@yamt/shared";
import { ArrowLeft, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { AddStrip } from "@/components/add-strip";
import { CaptureList, useCaptureRows } from "@/components/capture-list";
import { AgainList, LogAgainSheet, type RepeatSource } from "@/components/log-again";
import { MealDetail } from "@/components/meal-detail";
import { RecorderBand } from "@/components/recorder-band";
import {
  Band,
  BottomSlab,
  iconButtonClass,
  Label,
  SafeBottom,
  SlabButton,
  StatusLabel,
  Strip,
} from "@/components/slab";
import { type Recording, useRecorder } from "@/hooks/use-recorder";
import { formatDayTime, formatTime, plural } from "@/lib/format";
import { type CaptureEntry, CaptureRejected, outbox, type PendingCapture, useMealOutbox } from "@/lib/outbox";
import { useMeal } from "@/lib/queries";
import { recordingName } from "@/lib/recorder";

interface MealSearch {
  /** The meal was just started with Log meal (it exists only here until its first capture is up). */
  new?: true;
  /** The capture view of a meal that has a detail: add more to it. */
  add?: true;
}

const flag = (v: unknown) => v === true || v === "1" || v === "true" || v === 1;

export const Route = createFileRoute("/meals/$mealId")({
  validateSearch: (s: Record<string, unknown>): MealSearch => ({
    ...(flag(s.new) ? { new: true as const } : {}),
    ...(flag(s.add) ? { add: true as const } : {}),
  }),
  component: MealRoute,
});

/**
 * One route per meal. A meal with an analysis (or a failed one) opens on its detail: numbers,
 * questions, items, corrections, revisions, trace, captures. A meal without one yet (draft,
 * queued, analysing for the first time) opens on the capture view, and so does `?add=1`, the
 * detail's way to add more.
 */
function MealRoute() {
  const { mealId } = Route.useParams();
  const search = Route.useSearch();
  const query = useMeal(mealId);
  const detail = query.data ?? null;
  if (query.isPending && !search.new) return <Loading />;
  if (detail && (detail.revision || detail.meal.status === "failed") && !search.add) {
    return <MealDetail detail={detail} />;
  }
  // the query goes along: a second observer mounting here would refetch an errored query, which
  // flips it back to pending (Loading) and unmounts this again, offline in a loop
  return (
    <MealCapture mealId={mealId} query={query} isNew={search.new === true} adding={search.add === true} />
  );
}

/**
 * A meal's capture screen: Log meal opens it for a new meal, the overview for one without an
 * analysis, the detail's "Add to this meal" for one with. Record, attach photos and audio files,
 * add notes and links; everything goes through the upload queue (kept on the phone until the
 * server has it); Analyse / Re-analyse at the bottom.
 */
function MealCapture({
  mealId,
  query,
  isNew,
  adding,
}: {
  mealId: string;
  query: ReturnType<typeof useMeal>;
  isNew: boolean;
  adding: boolean;
}) {
  const navigate = useNavigate();
  const detail = query.data ?? null;
  const { snapshot, entries } = useMealOutbox(mealId);
  const [problem, setProblem] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const [again, setAgain] = useState<RepeatSource | null>(null);

  const save = async (capture: PendingCapture, capturedAt?: number) => {
    setProblem(null);
    try {
      await outbox.addCapture(mealId, capture, capturedAt);
    } catch (e) {
      setProblem(e instanceof CaptureRejected ? e.message : `Couldn't keep that: ${(e as Error).message}`);
    }
  };

  const recorder = useRecorder((r: Recording) => {
    void save(
      {
        kind: "audio",
        blob: r.blob,
        fileName: recordingName(r.startedAt, r.mimeType),
        mimeType: r.mimeType,
        durationMs: r.durationMs,
      },
      r.startedAt,
    );
  });

  const captureEntries = useMemo(
    () => entries.filter((e): e is CaptureEntry => e.type === "capture"),
    [entries],
  );
  const rows = useCaptureRows(mealId, detail, captureEntries, snapshot, setProblem);
  // back to the detail when adding to an analysed meal, else to the overview
  const back = adding ? { to: "/meals/$mealId" as const, params: { mealId } } : { to: "/" as const };

  if (query.isError && !detail && captureEntries.length === 0 && !isNew && snapshot.ready) {
    return <Missing text="Can't reach yamt right now, and nothing of this meal is on this phone." />;
  }
  if (detail === null && captureEntries.length === 0 && !isNew && snapshot.ready && !query.isError) {
    return <Missing text="This meal doesn't exist." />;
  }

  const meal = detail?.meal ?? null;
  const revision = detail?.revision ?? null;
  const status: MealStatus = meal?.status ?? "draft";
  const title = revision?.revision.title ?? (meal || captureEntries.length ? "Untitled meal" : "Log meal");
  const uploading = captureEntries.filter((e) => !e.failed).length;
  const refused = captureEntries.filter((e) => e.failed).length;

  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label className="flex items-center gap-2 text-muted-foreground">
              {meal ? formatDayTime(meal.eatenAt) : `New meal · ${formatTime(openedAt)}`}
              {meal && meal.status !== "draft" && (
                <>
                  <span>·</span>
                  <StatusLabel
                    status={status}
                    className={
                      status === "needs_input" ? "bg-lime px-1.5 py-0.5 text-lime-foreground" : undefined
                    }
                  />
                </>
              )}
            </Label>
            <h1 className="display mt-1 text-[32px] leading-[0.95]" data-testid="meal-title">
              {title}
            </h1>
          </div>
          <Link {...back} className={iconButtonClass} aria-label={meal ? "Back" : "Close"}>
            {meal ? (
              <ArrowLeft className="size-6" strokeWidth={2.5} />
            ) : (
              <X className="size-6" strokeWidth={2.5} />
            )}
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* The recorder is the one thing here; an analysed meal's numbers live on its detail. */}
        <RecorderBand recorder={recorder} />
        <AddStrip
          disabled={recorder.busy}
          onFiles={(kind, files) => {
            for (const f of files) {
              void save({
                kind,
                blob: f,
                fileName: f.name || (kind === "image" ? "photo.jpg" : "audio.m4a"),
                mimeType: f.type,
              });
            }
          }}
          onNote={(text) => void save({ kind: "text", text })}
          onLink={(url, text) => void save({ kind: "link", url, ...(text ? { text } : {}) })}
          onCaptures={(captures) => {
            for (const c of captures) void save(c);
          }}
        />
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
        <Strip
          title="Captures"
          meta={[rows.length, uploading && `${uploading} uploading`, refused && `${refused} refused`]
            .filter(Boolean)
            .join(" · ")}
        />
        {rows.length > 0 ? (
          <CaptureList rows={rows} />
        ) : (
          <p className="px-5 py-6 font-medium text-muted-foreground">
            Nothing yet. Record what you're eating, or add a photo, note, link or audio file, or paste one.
          </p>
        )}
        {/* Log meal, before anything is captured: the same as before, without an analysis (#30) */}
        {isNew && !meal && rows.length === 0 && <AgainList onPick={setAgain} />}
      </main>
      <LogAgainSheet
        source={again}
        onClose={() => setAgain(null)}
        onLogged={() => {
          setAgain(null);
          void navigate({ to: "/" });
        }}
      />

      <AnalyseSlab
        mealId={mealId}
        detail={detail}
        pendingCaptures={captureEntries.length}
        refused={refused}
        queued={entries.some((e) => e.type === "analyse")}
        recording={recorder.busy}
        online={snapshot.online}
        onQueued={() => (adding ? navigate(back) : navigate({ to: "/" }))}
      />
    </>
  );
}

/**
 * Analyse / Re-analyse. It goes through the upload queue, so pressing it while captures are still
 * uploading (or offline) is fine: the analysis starts once they're all up.
 */
function AnalyseSlab(props: {
  mealId: string;
  detail: MealDetailResponse | null;
  pendingCaptures: number;
  refused: number;
  queued: boolean;
  recording: boolean;
  online: boolean;
  onQueued: () => void;
}) {
  const { detail, pendingCaptures, refused, queued, recording, online } = props;
  const status: MealStatus = detail?.meal.status ?? "draft";
  const live = detail?.captures.filter((c) => c.retractedAt === null) ?? [];
  const revisionAt = detail?.revision?.revision.createdAt ?? null;
  const newSinceRevision =
    revisionAt === null ? live.length : live.filter((c) => c.createdAt > revisionAt).length;
  const anything = live.length + pendingCaptures > 0;

  const analyse = async () => {
    await outbox.requestAnalyse(props.mealId);
    props.onQueued();
  };

  if (queued) {
    const hint =
      refused > 0
        ? "An upload was refused: retry or discard it, then the analysis starts."
        : pendingCaptures > 0
          ? `The analysis starts when ${plural(pendingCaptures, "upload")} ${pendingCaptures === 1 ? "is" : "are"} up.`
          : online
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
      <BottomSlab>
        <SlabButton disabled>
          <span className="size-3 animate-pulse bg-current" /> {status === "queued" ? "Queued" : "Analysing…"}
        </SlabButton>
      </BottomSlab>
    );
  }

  // an analysed meal offers Re-analyse once there is something new
  const analysed = status === "analysed" || status === "needs_input";
  if (analysed && newSinceRevision + pendingCaptures === 0) return <SafeBottom />;

  const label = analysed ? "Re-analyse" : status === "failed" ? "Retry analysis" : "Analyse";
  const going = pendingCaptures - refused;
  const hint = recording
    ? "Stop the recording first."
    : refused > 0
      ? `${plural(refused, "upload")} refused: retry or discard ${refused === 1 ? "it" : "them"} first.`
      : going > 0
        ? `${plural(going, "upload")} still going. ${label} waits for them.`
        : undefined;
  return (
    <BottomSlab hint={hint}>
      <SlabButton disabled={!anything || recording || refused > 0} onClick={() => void analyse()}>
        <Zap className="size-7 fill-current" strokeWidth={2.5} /> {label}
      </SlabButton>
    </BottomSlab>
  );
}

function Loading() {
  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <Label className="text-muted-foreground">Meal</Label>
        <h1 className="display mt-1 text-[32px]">Loading…</h1>
      </header>
      <SafeBottom />
    </>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <>
      <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <h1 className="display mt-1 text-[32px]">Meal not found</h1>
        <Link to="/" className={iconButtonClass} aria-label="Back">
          <ArrowLeft className="size-6" strokeWidth={2.5} />
        </Link>
      </header>
      <p className="px-5 py-6 font-medium text-muted-foreground">{text}</p>
    </>
  );
}
