// Settings → Planning (#46): the defaults a new request's filters fall back to (suggestions per
// round, recipe source, portions to cook), the nightly run (#48: on/off, when, how many) and the
// preferences the plan-meals skill reads (never eat, dislikes, equipment, weekday cooking time,
// favourite sites). One setting, saved whole.
import type {
  NightlySettings,
  PlanningPreferences,
  PlanningSettingsBody,
  RecipeSourceMode,
} from "@yamt/shared";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { usePlanningSettings, useSavePlanningSettings } from "@/lib/queries";
import { CaptureSheet, fieldClass } from "./add-strip";
import { ChoiceList, ChoiceRow, Stepper, Switch } from "./choice";
import { Label, SlabButton, Strip } from "./slab";

const SOURCE_MODES: { value: RecipeSourceMode; title: string; detail: string }[] = [
  { value: "published", title: "Real recipes only", detail: "As published, with its source" },
  { value: "adapted", title: "Based on a real recipe", detail: "Changed for the goal and the request" },
  { value: "composed", title: "Free", detail: "May compose its own recipe" },
];

type PreferenceField = "dislikes" | "neverEat" | "equipment" | "favouriteSites";

const LIST_FIELDS: {
  field: PreferenceField;
  title: string;
  description: string;
  placeholder: string;
}[] = [
  {
    field: "neverEat",
    title: "Never eat",
    description: "One a line; a suggestion with one of these is wrong",
    placeholder: "Erdnüsse\nMeeresfrüchte",
  },
  {
    field: "dislikes",
    title: "Dislikes",
    description: "One a line; avoided where there's a better option",
    placeholder: "Rosenkohl\nInnereien",
  },
  {
    field: "equipment",
    title: "Equipment",
    description: "What the kitchen has, one a line",
    placeholder: "Airfryer\nkein Ofen",
  },
  {
    field: "favouriteSites",
    title: "Favourite sites",
    description: "Looked at first for a real recipe, one a line",
    placeholder: "chefkoch.de\nessen-und-trinken.de",
  },
];

const summary = (items: string[]) => (items.length ? items.join(", ") : "None set");

/** A full-width row, like the agent settings' model picker: title, summary, a chevron. */
function SettingsRow({
  title,
  detail,
  onSelect,
  ...props
}: {
  title: string;
  detail: string;
  onSelect: () => void;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-[72px] w-full items-center gap-4 border-border border-b px-5 py-3 text-left outline-none focus-visible:bg-tint"
      {...props}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-[17px] leading-tight">{title}</span>
        <span className="mt-0.5 block truncate font-medium text-muted-foreground text-sm">{detail}</span>
      </span>
      <ChevronRight className="size-6 shrink-0 text-muted-foreground" strokeWidth={2.5} />
    </button>
  );
}

function ListSheet({
  open,
  title,
  description,
  placeholder,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  description: string;
  placeholder: string;
  value: string[];
  onClose: () => void;
  onSave: (lines: string[]) => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  // the sheet's own text is seeded fresh each time it opens, not kept in sync while closed
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when it opens
  useEffect(() => {
    if (open) setText(value.join("\n"));
  }, [open]);
  const save = () => {
    onSave(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    onClose();
  };
  return (
    <CaptureSheet open={open} onClose={onClose} title={title} description={description}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={title}
        rows={5}
        className={`${fieldClass} min-h-32 resize-none`}
      />
      <SlabButton onClick={save}>Save</SlabButton>
    </CaptureSheet>
  );
}

function MinutesSheet({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: number | null;
  onClose: () => void;
  onSave: (minutes: number | null) => void;
}) {
  const [text, setText] = useState(value?.toString() ?? "");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when it opens
  useEffect(() => {
    if (open) setText(value?.toString() ?? "");
  }, [open]);
  const n = text.trim() ? Number(text) : null;
  const valid = n === null || (Number.isInteger(n) && n >= 5 && n <= 240);
  const save = (minutes: number | null) => {
    onSave(minutes);
    onClose();
  };
  return (
    <CaptureSheet open={open} onClose={onClose} title="Weekday cooking time" description="Monday to Friday">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. 30"
        aria-label="Most minutes of active cooking on a weekday"
        aria-invalid={!valid}
        inputMode="numeric"
        className={fieldClass}
      />
      {!valid && (
        <p className="px-5 pt-2 font-medium text-muted-foreground text-sm">5 to 240 minutes, or none.</p>
      )}
      <div className="flex gap-3 p-3">
        <SlabButton tone="tint" onClick={() => save(null)}>
          No limit
        </SlabButton>
        <SlabButton onClick={() => valid && save(n)} disabled={!valid}>
          Save
        </SlabButton>
      </div>
    </CaptureSheet>
  );
}

function TimeSheet({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
  onSave: (time: string) => void;
}) {
  const [text, setText] = useState(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when it opens
  useEffect(() => {
    if (open) setText(value);
  }, [open]);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  return (
    <CaptureSheet
      open={open}
      onClose={onClose}
      title="When it runs"
      description="The server's time; a run takes a few minutes"
    >
      <input
        type="time"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="When the nightly run starts"
        aria-invalid={!valid}
        className={fieldClass}
        data-testid="nightly-time-input"
      />
      <SlabButton
        onClick={() => {
          if (!valid) return;
          onSave(text);
          onClose();
        }}
        disabled={!valid}
      >
        Save
      </SlabButton>
    </CaptureSheet>
  );
}

/**
 * The nightly run (#48): a switch, and while on its time (a sheet) and how many suggestions. Off
 * by default: a run a day costs about as much as a request.
 */
function NightlyEditor({
  nightly,
  onSave,
}: {
  nightly: NightlySettings;
  onSave: (next: NightlySettings) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
        <Label>Tonight's suggestions</Label>
        <Label className="text-muted-foreground">nightly run</Label>
      </div>
      <ul className="divide-y divide-border border-border border-y" data-testid="planning-nightly">
        <li>
          <button
            type="button"
            role="switch"
            aria-checked={nightly.enabled}
            aria-label="Suggest for today each night"
            onClick={() => onSave({ ...nightly, enabled: !nightly.enabled })}
            className="flex min-h-[72px] w-full items-center gap-4 px-5 py-3 text-left outline-none focus-visible:bg-tint"
            data-testid="nightly-switch"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-[17px] leading-tight">Suggest for today each night</span>
              <span className="mt-0.5 block font-medium text-muted-foreground text-sm leading-snug">
                Complete suggestions for today's open meals and fresh starters, ready by morning. A run a
                night costs about as much as a request.
              </span>
            </span>
            <Switch on={nightly.enabled} />
          </button>
        </li>
        {nightly.enabled && (
          <>
            <li>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex min-h-[72px] w-full items-center gap-4 px-5 py-3 text-left outline-none focus-visible:bg-tint"
                data-testid="nightly-time"
              >
                <span className="min-w-0 flex-1">
                  <span className="display block text-[28px] leading-none">{nightly.time}</span>
                  <span className="mt-1 block font-medium text-muted-foreground text-sm">
                    When it runs · the server's time
                  </span>
                </span>
                <ChevronRight className="size-6 shrink-0 text-muted-foreground" strokeWidth={2.5} />
              </button>
            </li>
            <li className="px-5 pt-4 pb-4">
              <Label className="mb-2 block text-muted-foreground">How many</Label>
              <Stepper
                label="Nightly suggestions"
                value={nightly.count}
                min={1}
                max={5}
                unit={nightly.count === 1 ? "idea" : "ideas"}
                onChange={(count) => onSave({ ...nightly, count })}
              />
            </li>
          </>
        )}
      </ul>
      <TimeSheet
        open={editing}
        value={nightly.time}
        onClose={() => setEditing(false)}
        onSave={(time) => onSave({ ...nightly, time })}
      />
    </>
  );
}

function PreferencesEditor({
  preferences,
  onSave,
}: {
  preferences: PlanningPreferences;
  onSave: (next: PlanningPreferences) => void;
}) {
  const [editing, setEditing] = useState<PreferenceField | "weekdayCookingMin" | null>(null);
  return (
    <>
      <Strip title="Preferences" meta="for the agent" />
      <p className="px-5 pt-4 pb-2 font-medium">
        Personal, kept only here: never shown in the app's repo, an issue or a log.
      </p>
      <ChoiceList label="Preferences">
        {LIST_FIELDS.map(({ field, title }) => (
          <SettingsRow
            key={field}
            title={title}
            detail={summary(preferences[field])}
            onSelect={() => setEditing(field)}
            data-testid={`planning-pref-${field}`}
          />
        ))}
        <SettingsRow
          title="Weekday cooking time"
          detail={
            preferences.weekdayCookingMin ? `${preferences.weekdayCookingMin} min, Mon–Fri` : "No limit"
          }
          onSelect={() => setEditing("weekdayCookingMin")}
          data-testid="planning-pref-weekdayCookingMin"
        />
      </ChoiceList>

      {LIST_FIELDS.map(({ field, title, description, placeholder }) => (
        <ListSheet
          key={field}
          open={editing === field}
          title={title}
          description={description}
          placeholder={placeholder}
          value={preferences[field]}
          onClose={() => setEditing(null)}
          onSave={(lines) => onSave({ ...preferences, [field]: lines })}
        />
      ))}
      <MinutesSheet
        open={editing === "weekdayCookingMin"}
        value={preferences.weekdayCookingMin}
        onClose={() => setEditing(null)}
        onSave={(weekdayCookingMin) => onSave({ ...preferences, weekdayCookingMin })}
      />
    </>
  );
}

function PlanningSettingsForm({ settings }: { settings: PlanningSettingsBody }) {
  const save = useSavePlanningSettings();
  const put = (patch: Partial<PlanningSettingsBody>) => {
    if (!save.isPending) save.mutate({ ...settings, ...patch });
  };

  return (
    <>
      <div className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
        <Label>Suggestions per round</Label>
      </div>
      <fieldset className="px-5 pb-2" aria-label="Suggestions per round">
        <Stepper
          label="Suggestions per round"
          value={settings.count}
          min={2}
          max={5}
          unit="per round"
          onChange={(count) => put({ count })}
        />
      </fieldset>

      <div className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
        <Label>Recipe source</Label>
      </div>
      <ChoiceList label="Recipe source" className="border-border border-b" data-testid="planning-source-mode">
        {SOURCE_MODES.map((m) => (
          <ChoiceRow
            key={m.value}
            title={m.title}
            detail={m.detail}
            selected={settings.sourceMode === m.value}
            onSelect={() => put({ sourceMode: m.value })}
            data-value={m.value}
          />
        ))}
      </ChoiceList>

      <div className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
        <Label>Portions to cook</Label>
      </div>
      <fieldset className="px-5 pb-2" aria-label="Portions to cook">
        <Stepper
          label="Portions to cook"
          value={settings.portionsCooked}
          min={1}
          max={4}
          unit="portions"
          onChange={(portionsCooked) => put({ portionsCooked })}
        />
      </fieldset>

      <NightlyEditor nightly={settings.nightly} onSave={(nightly) => put({ nightly })} />

      {save.isError && (
        <p className="mt-4 bg-orange px-5 py-3 font-medium text-orange-foreground" role="alert">
          Couldn't save: {save.error.message}
        </p>
      )}

      <PreferencesEditor preferences={settings.preferences} onSave={(preferences) => put({ preferences })} />
    </>
  );
}

/** Settings → Planning (#36, #46): the request defaults and the preferences. */
export function PlanningSettings() {
  const settings = usePlanningSettings();
  const s = settings.data?.settings;
  return (
    <section data-testid="planning-settings">
      <Strip title="Planning" meta="requests" />
      <p className="px-5 pt-4 font-medium">
        Defaults for a new planning request (suggestions per round, recipe source, portions to cook), the
        nightly suggestions, and what the agent should know about you.
      </p>
      {settings.isError ? (
        <p className="mt-4 bg-orange px-5 py-3 font-medium text-orange-foreground" role="alert">
          Can't load the planning settings: {settings.error.message}
        </p>
      ) : s ? (
        <PlanningSettingsForm settings={s} />
      ) : (
        <p className="px-5 py-4 font-medium text-muted-foreground text-sm">Loading…</p>
      )}
    </section>
  );
}
