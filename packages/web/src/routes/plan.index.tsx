import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { addDays, requestTitle } from "@yamt/shared";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Composer, Dock } from "@/components/composer";
import { FilterSummary, StarterBand } from "@/components/plan-request";
import { BackButton, iconButtonClass, Label, Strip } from "@/components/slab";
import { formatLongDate, localDate } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { outbox, usePlanningOutbox } from "@/lib/outbox";
import { clearDraft, ENTRY_DRAFT, sendDraft, useDraft } from "@/lib/plan-draft";
import { draftProblem, filterDefaults, requestState, resolveDraft, summaryWords } from "@/lib/plan-request";
import {
  browserZone,
  usePlan,
  usePlanningRequest,
  usePlanningRequests,
  usePlanningSettings,
  useRepeatable,
} from "@/lib/queries";
import { computeStarters, type LastRequest, type Starter } from "@/lib/starters";

export const Route = createFileRoute("/plan/")({ component: PlanEntry });

const TONES = ["ink", "tint", "plain"] as const;

/**
 * "What to cook?" (#47, G's entry): starters computed from what the app knows (a tap fills the
 * composer and the filters), the open requests, and docked at the bottom the filter summary (to the
 * filter page) over the composer. Sending queues the request, its inputs and its first round, and
 * opens its thread.
 */
function PlanEntry() {
  const navigate = useNavigate();
  const now = Date.now();
  const today = localDate(now);
  const settings = usePlanningSettings();
  const plan = usePlan(today, addDays(today, 1));
  const repeatable = useRepeatable();
  const requests = usePlanningRequests();
  const queued = usePlanningOutbox();
  const [draft, setDraft] = useDraft(ENTRY_DRAFT);
  const lastSummary = requests.data?.requests.find((r) => r.request.origin === "user");
  const lastDetail = usePlanningRequest(lastSummary?.request.id ?? "", !!lastSummary);

  const defaults = filterDefaults(settings.data?.settings);
  const filters = resolveDraft(draft.filters, defaults, today);
  const problem = draftProblem(filters);

  const last = useMemo((): LastRequest | null => {
    const d = lastDetail.data;
    if (!d) return null;
    const suggestions = d.rounds.flatMap((r) => r.suggestions).filter((s) => s.status === "ready");
    return {
      request: d.request,
      text: d.inputs.find((i) => i.kind === "text" && i.retractedAt === null)?.text ?? null,
      picked: suggestions.filter((s) => s.verdict === "picked").length,
      suggested: suggestions.length,
    };
  }, [lastDetail.data]);
  const starters = computeStarters({
    today,
    now,
    days: plan.data?.days ?? [],
    repeatable: repeatable.data?.meals ?? [],
    last,
  });

  const pick = (s: Starter) => setDraft((d) => ({ ...d, text: s.composerText, filters: s.draft }));

  const send = async () => {
    const requestId = uuidv7();
    await sendDraft(outbox, draft, { requestId, create: { filters, tz: browserZone() }, round: true });
    clearDraft(ENTRY_DRAFT);
    void navigate({ to: "/plan/requests/$id", params: { id: requestId } });
  };

  // requests made on this phone the server doesn't list yet, then the open ones
  const known = new Set((requests.data?.requests ?? []).map((r) => r.request.id));
  const onPhone = queued.entries.flatMap((e) =>
    e.type === "plan-request" && !known.has(e.requestId) ? [e] : [],
  );
  const open = requests.data?.requests ?? [];

  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <BackButton />
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground">Plan · {formatLongDate(now)}</Label>
          <h1 className="display mt-1 text-[36px]">What to cook?</h1>
        </div>
        <Link to="/plan/days" className={iconButtonClass} aria-label="Plan view">
          <CalendarDays className="size-6" strokeWidth={2.5} />
        </Link>
      </header>

      <main className="flex-1">
        <section aria-label="Start from">
          <Strip title="Start from" meta="from your days" />
          <ul className="divide-y divide-border" data-testid="starters">
            {starters.map((s, i) => (
              <StarterBand
                key={s.id}
                s={s}
                tone={i === 0 ? "ink" : (TONES[1 + ((i - 1) % 2)] ?? "plain")}
                onPick={pick}
              />
            ))}
          </ul>
        </section>

        {(onPhone.length > 0 || open.length > 0) && (
          <section aria-label="Your requests">
            <Strip title="Your requests" meta={`${onPhone.length + open.length} open`} />
            <ul className="divide-y divide-border" data-testid="requests">
              {onPhone.map((e) => (
                <RequestRow
                  key={e.requestId}
                  id={e.requestId}
                  title={requestTitle(e.filters)}
                  state={e.failed ? "Not sent" : "On this phone"}
                />
              ))}
              {open.map((r) => (
                <RequestRow
                  key={r.request.id}
                  id={r.request.id}
                  title={r.request.title}
                  state={requestState(r)?.label ?? `${r.latestRound?.ready ?? 0} suggested`}
                />
              ))}
            </ul>
          </section>
        )}
      </main>

      <Dock
        above={
          <>
            {problem && (
              <Label
                className="bg-tint px-5 pt-2.5 text-center text-muted-foreground normal-case tracking-normal"
                role="status"
              >
                {problem}
              </Label>
            )}
            <FilterSummary
              words={summaryWords(filters, defaults, today)}
              onOpen={() => void navigate({ to: "/plan/filters" })}
            />
          </>
        }
      >
        <Composer
          draftKey={ENTRY_DRAFT}
          placeholder="Or say what you fancy…"
          sendLabel="Suggest"
          blocked={problem !== null || settings.isPending}
          onSend={() => void send()}
        />
      </Dock>
    </>
  );
}

/** An open request as a plain row: its title and how it stands. */
function RequestRow({ id, title, state }: { id: string; title: string; state: string }) {
  return (
    <li>
      <Link
        to="/plan/requests/$id"
        params={{ id }}
        className="flex min-h-14 items-center gap-3 px-5 py-2 outline-none active:bg-tint focus-visible:underline"
        data-testid="request-row"
      >
        <span className="min-w-0 flex-1 truncate font-bold">{title}</span>
        <Label className="shrink-0 text-muted-foreground">{state}</Label>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
      </Link>
    </li>
  );
}
