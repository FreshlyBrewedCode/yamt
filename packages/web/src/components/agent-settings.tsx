// Settings → Agent (#28): which harness analyses meals, with which model and reasoning effort.
// Everything offered comes from the harness itself (the server starts it once to ask), shown by
// its labels; ids only where the harness gives nothing better.
import {
  type AgentChoice,
  type AgentOption,
  type AgentResponse,
  choiceLabel,
  type DiscoveryFailure,
  HARNESS_LABELS,
  type HarnessKind,
  type SourcedValue,
} from "@yamt/shared";
import { cn } from "cn";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAgent, useAgentOptions, useRefreshAgentOptions, useSaveAgent } from "@/lib/queries";
import { CaptureSheet, fieldClass } from "./add-strip";
import { Chips, ChoiceList, ChoiceRow } from "./choice";
import { Label, Strip } from "./slab";

const HARNESS_DETAIL: Record<HarnessKind, string> = {
  "claude-code": "Anthropic's models, with the server's claude login",
  opencode: "Any provider OpenCode is logged in to on the server",
  custom: "The ACP agent set up in config.json",
};

/** Where a value comes from, as the micro-label beside its heading. */
export function sourceText(v: SourcedValue<unknown>): string {
  switch (v.source) {
    case "env":
      return `Fixed by ${v.envVar ?? "the env"}`;
    case "app":
      return "Set here";
    case "config":
      return "From config.json";
    default:
      return "Default";
  }
}

const FIX: Record<DiscoveryFailure, (h: HarnessKind) => string> = {
  auth: (h) =>
    h === "opencode"
      ? "Log in on the server with `opencode auth login`, then Refresh."
      : h === "claude-code"
        ? "Log in on the server by running `claude` once, then Refresh."
        : "Log in with the agent's own CLI on the server, then Refresh.",
  not_installed: () => "Install it on the server, then Refresh.",
  error: () => "Refresh to try again.",
};

/** "just now", "4 min ago", "2 h ago". */
function ago(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

function SubHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
      <Label>{title}</Label>
      <Label className="truncate text-muted-foreground">{meta}</Label>
    </div>
  );
}

/** The app's setting as it stands: what to send back unchanged. */
const appValue = (v: SourcedValue<string | null>) => (v.source === "app" ? v.value : null);

export function AgentSettings() {
  const agent = useAgent();
  const a = agent.data;
  return (
    <section data-testid="agent-settings">
      <Strip title="Agent" meta="meal analysis" />
      <p className="px-5 pt-4 font-medium">
        Which agent analyses your meals, with which model and how hard it thinks. Changes apply to the next
        analysis; one already running keeps its settings.
      </p>
      {agent.isError ? (
        <p className="mt-4 bg-orange px-5 py-3 font-medium text-orange-foreground" role="alert">
          Can't load the agent settings: {agent.error.message}
        </p>
      ) : a ? (
        <AgentForm agent={a} />
      ) : (
        <p className="px-5 py-4 font-medium text-muted-foreground text-sm">Loading…</p>
      )}
    </section>
  );
}

function AgentForm({ agent: a }: { agent: AgentResponse }) {
  const save = useSaveAgent();
  const refresh = useRefreshAgentOptions();
  const [picking, setPicking] = useState(false);
  const harness = a.harness.value;
  const label = HARNESS_LABELS[harness];
  const info = a.harnesses.find((h) => h.kind === harness);
  const options = useAgentOptions(harness, a.model.value, info?.available ?? false);
  const o = options.data;
  const models = o?.models ?? null;
  const model = a.model.value ?? models?.current ?? null;
  const effort = o?.effort ?? null;
  const effortValue = a.effort.value ?? effort?.current ?? null;
  const fixed = {
    harness: a.harness.source === "env",
    model: a.model.source === "env",
    effort: a.effort.source === "env",
  };
  const failure =
    options.error instanceof ApiError ? (options.error.hint as DiscoveryFailure | undefined) : undefined;

  // one change at a time: a tap while one is saving is ignored
  const put = (body: Parameters<typeof save.mutate>[0]) => {
    if (!save.isPending) save.mutate(body);
  };
  const pickHarness = (kind: HarnessKind) => {
    if (kind !== harness) put({ harness: kind, model: null, effort: null });
  };
  const pickModel = (value: string) => {
    setPicking(false);
    if (value !== model)
      put({ harness, model: value, effort: appValue(a.effort), keepEffortIfOffered: true });
  };
  const pickEffort = (value: string) => {
    if (value !== effortValue) put({ harness, model: appValue(a.model), effort: value });
  };

  return (
    <>
      <SubHead title="Harness" meta={sourceText(a.harness)} />
      <ChoiceList label="Harness" className="border-border border-b" data-testid="agent-harness">
        {a.harnesses.map((h) => {
          const chosen = h.kind === harness;
          return (
            <ChoiceRow
              key={h.kind}
              title={h.label}
              detail={
                !h.available
                  ? `Not available: ${h.reason}`
                  : chosen && o?.agent
                    ? `${o.agent.name}${o.agent.version ? ` ${o.agent.version}` : ""} · ${HARNESS_DETAIL[h.kind]}`
                    : HARNESS_DETAIL[h.kind]
              }
              selected={chosen}
              disabled={!h.available || fixed.harness}
              onSelect={() => pickHarness(h.kind)}
              data-kind={h.kind}
            />
          );
        })}
      </ChoiceList>

      {options.isError ? (
        <div
          className="bg-orange px-5 py-3 font-medium text-orange-foreground"
          role="alert"
          data-testid="agent-error"
        >
          <p className="font-bold">{options.error.message}</p>
          <p className="mt-1 text-sm">{FIX[failure ?? "error"](harness)}</p>
        </div>
      ) : options.isPending && info?.available ? (
        <p className="px-5 pt-5 font-medium text-muted-foreground text-sm" role="status">
          Asking {label} for its models…
        </p>
      ) : null}

      {o && (
        <>
          <SubHead title="Model" meta={sourceText(a.model)} />
          {models ? (
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={fixed.model}
              className="flex min-h-[72px] w-full items-center gap-4 border-border border-y px-5 py-3 text-left outline-none focus-visible:bg-tint disabled:text-muted-foreground"
              data-testid="agent-model"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-[17px] leading-tight">
                  {model ? choiceLabel(models, model) : "—"}
                </span>
                <span className="mt-0.5 block truncate font-medium text-muted-foreground text-sm">
                  {model && !models.choices.some((c) => c.value === model)
                    ? harness === "claude-code"
                      ? `${a.model.source === "default" ? "yamt's default" : `Not in ${label}'s list`}; passed on as it is`
                      : `Not offered by ${label}: its default runs`
                    : a.model.value === null
                      ? `${label}'s own default`
                      : (models.choices.find((c) => c.value === model)?.description ?? model)}
                </span>
              </span>
              {!fixed.model && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Label>{models.choices.length}</Label>
                  <ChevronRight className="size-6" strokeWidth={2.5} />
                </span>
              )}
            </button>
          ) : (
            <p className="px-5 pb-1 font-medium text-muted-foreground text-sm">
              {label} has no model setting.
            </p>
          )}

          <SubHead title="Effort" meta={sourceText(a.effort)} />
          {effort ? (
            <div className="px-5" data-testid="agent-effort">
              <Chips
                label="Effort"
                options={effort.choices.map((c) => ({ value: c.value, label: c.name }))}
                value={effort.choices.some((c) => c.value === effortValue) ? effortValue : null}
                onChange={pickEffort}
                disabled={fixed.effort}
              />
              {a.effort.value !== null && !effort.choices.some((c) => c.value === a.effort.value) && (
                <p className="mt-2 font-medium text-muted-foreground text-sm">
                  {a.effort.value} isn't offered for this model, so the harness's default runs.
                </p>
              )}
            </div>
          ) : (
            <p className="px-5 font-medium text-muted-foreground text-sm" data-testid="agent-no-effort">
              {model ? choiceLabel(models, model) : "This model"} has no effort setting.
            </p>
          )}
        </>
      )}

      {save.isError && (
        <p className="mt-4 bg-orange px-5 py-3 font-medium text-orange-foreground" role="alert">
          Couldn't save: {save.error.message}
        </p>
      )}

      {info?.available && (
        <button
          type="button"
          onClick={() => refresh.mutate({ harness, model: a.model.value })}
          disabled={refresh.isPending || options.isFetching}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 px-5 text-left outline-none focus-visible:bg-tint disabled:opacity-60",
            o && "mt-4 border-border border-t",
          )}
          data-testid="agent-refresh"
        >
          <RefreshCw
            className={cn("size-5 shrink-0", refresh.isPending && "animate-spin")}
            strokeWidth={2.5}
          />
          <span className="flex-1 font-bold uppercase tracking-[0.08em]">
            {refresh.isPending ? "Asking…" : "Refresh options"}
          </span>
          {o && <Label className="text-muted-foreground">Read {ago(o.discoveredAt)}</Label>}
        </button>
      )}

      {models && (
        <ModelSheet
          open={picking}
          onClose={() => setPicking(false)}
          option={models}
          value={model}
          harnessLabel={label}
          onPick={pickModel}
        />
      )}
    </>
  );
}

/** How many rows the picker renders at once; search narrows OpenCode's ~600. */
const SHOWN = 80;

/**
 * The model picker: a top sheet (like Note and Link) with the harness's models as choice rows,
 * under their group (OpenCode's providers); a search field once there are more than a screenful.
 */
function ModelSheet({
  open,
  onClose,
  option,
  value,
  harnessLabel,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  option: AgentOption;
  value: string | null;
  harnessLabel: string;
  onPick: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const many = option.choices.length > 15;
  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return option.choices.filter((c) => {
      const hay = `${c.name} ${c.value} ${c.description ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [option, query]);
  const groups = useMemo(() => {
    const out: { group: string | null; choices: AgentChoice[] }[] = [];
    for (const c of matches.slice(0, SHOWN)) {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.choices.push(c);
      else out.push({ group: c.group, choices: [c] });
    }
    return out;
  }, [matches]);
  const name = (c: AgentChoice) =>
    c.group && c.name.startsWith(`${c.group}/`) ? c.name.slice(c.group.length + 1) : c.name;

  return (
    <CaptureSheet
      open={open}
      onClose={() => {
        setQuery("");
        onClose();
      }}
      title="Model"
      description={`${harnessLabel} · ${option.choices.length} models`}
    >
      {many && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          className={fieldClass}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      )}
      <div
        className="max-h-[70dvh] overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
        data-testid="model-list"
      >
        {groups.map((g, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: groups follow the harness's order
          <div key={i}>
            {g.group && <Label className="bg-tint px-5 pt-3 pb-2 text-muted-foreground">{g.group}</Label>}
            <ChoiceList label={g.group ?? "Models"}>
              {g.choices.map((c) => (
                <ChoiceRow
                  key={c.value}
                  title={name(c)}
                  detail={c.description ?? c.value}
                  selected={c.value === value}
                  onSelect={() => {
                    setQuery("");
                    onPick(c.value);
                  }}
                  data-value={c.value}
                />
              ))}
            </ChoiceList>
          </div>
        ))}
        {matches.length === 0 && (
          <p className="px-5 py-4 font-medium text-muted-foreground">No model matches “{query}”.</p>
        )}
        {matches.length > SHOWN && (
          <p className="px-5 py-4 font-medium text-muted-foreground text-sm">
            {matches.length - SHOWN} more: search to narrow them down.
          </p>
        )}
      </div>
    </CaptureSheet>
  );
}
