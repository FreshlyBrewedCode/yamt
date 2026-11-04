# yamt design: D · Slab

The design every UI subtask follows. Chosen in spike #5 ([verdict](https://github.com/FreshlyBrewedCode/yamt/issues/5)):
round 1 built three directions, the user took B · Blockprint as the base minus its poster look
(offset shadows, outlined cards); round 2 rebuilt it as **D · Slab**, and the user picked that.
The spike's code is at git tag `spike/5` (`packages/web/src/design/d/`); it never merges. The
real tokens live in `packages/web/src/index.css`, the real primitives in
`packages/web/src/components/slab.tsx`.

## Principles

1. **Screens are stacks of edge-to-edge filled bands.** No outlines, no shadows, no rounded
   cards, no gaps between sections, no margins around them. Sections are told apart only by
   their fill. Corners are square everywhere (`--radius: 0`); the record button is the one
   circle.
2. **Fill is the hierarchy.** Four fills, each with one job:

   | Fill | Means | Examples |
   |---|---|---|
   | **ink slab** | the one thing that matters on this screen (one per screen) | today's totals, the recorder, a meal's numbers, a day's progress |
   | **acid lime** | whatever wants the user: an action or something to answer | Log meal, Analyse, a needs-input row, the question, the weight entry |
   | **quiet tint** | secondary content and section headers | day headers, "Assumed", the trend, the add-more strip's pressed state |
   | **plain background** | lists, separated by thin dividers | meals of a day, captures, items |

   **Orange** is the fifth fill and only means failure (a failed meal row, a failed upload).
3. **Numbers are the content.** Big, bold, tabular. Labels are small uppercase micro-labels;
   they never compete with the number they describe.
4. **Actions are part of the layout.** The screen's main action is a sticky slab at the bottom
   of the column, inside the page flow: nothing floats over list content, there is no FAB.
5. **Calm by default, loud when needed.** Draft, queued and analysing are quiet grey labels;
   only "needs you" (lime) and "failed" (orange) fill a whole row.
6. **Mobile first, one hand.** 390×844 is the reference; large touch targets; the bottom slab
   is where the thumb is.

## Colour tokens

All colours come from the tokens in `index.css` (light on `:root`, dark on `.dark`, which follows
the OS). Components use Tailwind's token classes (`bg-ink text-ink-foreground`, `bg-lime`,
`bg-tint`, `bg-orange`, `bg-lime-soft`, `text-muted-foreground`, `divide-border`), never raw
colours. shadcn's semantic names are kept and mapped onto the palette, so shadcn components
look right without edits.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `oklch(0.985 0.005 95)` warm paper | `oklch(0.13 0 0)` near-black | the page, plain bands, lists |
| `--foreground` | `oklch(0.15 0 0)` | `oklch(0.97 0 0)` | text on the page |
| `--muted-foreground` | `oklch(0.45 0 0)` | `oklch(0.68 0 0)` | secondary text, quiet labels |
| `--border` | `oklch(0.15 0 0 / 14%)` | `oklch(1 0 0 / 14%)` | list dividers only |
| `--ink` | `oklch(0.15 0 0)` | `oklch(0.32 0 0)` raised charcoal | the ink slab |
| `--ink-foreground` | `oklch(0.985 0.005 95)` | `oklch(0.97 0 0)` | text on ink |
| `--ink-muted` | paper at 60 % | white at 62 % | labels on ink |
| `--ink-line` | paper at 18 % | white at 18 % | dividers and bar tracks on ink |
| `--lime` | `oklch(0.9 0.21 125)` | `oklch(0.88 0.22 125)` | acid lime fill (also `--primary`, `--ring`) |
| `--lime-foreground` | `oklch(0.15 0 0)` | `oklch(0.13 0 0)` | text on lime, and "ink inside lime" |
| `--lime-muted` | ink at 60 % | ink at 62 % | labels on lime |
| `--lime-soft` | `oklch(0.96 0.09 125)` | `oklch(0.3 0.08 125)` | low-confidence items, upload progress |
| `--tint` | `oklch(0.94 0.006 95)` | `oklch(0.2 0 0)` | quiet bands, icon tiles, inputs |
| `--orange` | `oklch(0.72 0.19 45)` | `oklch(0.72 0.18 45)` | failure rows |
| `--orange-foreground` | `oklch(0.15 0 0)` | `oklch(0.13 0 0)` | text on orange |
| `--destructive` | `oklch(0.62 0.22 30)` | `oklch(0.68 0.21 30)` | shadcn's destructive (rare) |

**Dark mode is its own palette, not an inversion.** The page goes near-black, so the ink slab
becomes a *raised* charcoal, lighter than the page, and tints lift rather than sink. Lime stays
lime. Ink-coloured buttons inside a lime band stay true black (`bg-lime-foreground`), since
charcoal on lime looks washed out.

**Correction from the verdict:** in the spike the dark ink slab (`0.27`) barely separated from
the page (`0.13`) on the overview. It is raised to **`0.32`**, so the order in dark is page
`0.13` < tint `0.2` < ink `0.32`, each step visible.

Contrast: text on ink, lime and orange is near-black on bright or near-white on dark, well above
4.5:1 in both modes. Muted labels are for labels, never for body copy the user must read.

## Type

- **Space Grotesk** (variable, self-hosted via `@fontsource-variable/space-grotesk`; no font
  CDN), fallback Helvetica Neue / Arial. One family for everything.
- **Tabular numbers everywhere** (`tabular-nums` on the app root), so columns of grams and kcal
  line up and live numbers don't jitter.
- **Display style** (`.display`): weight 700, letter-spacing −0.04em, line-height 0.9. For
  numbers and headings.
- **Micro-label** (`<Label>`): 12 px, bold, uppercase, tracking 0.08em. For what a number is,
  section meta, statuses, button captions.

| Role | Size | Style |
|---|---|---|
| Hero number (today's kcal, a meal's kcal) | 64 px | display |
| Recording timer | 60 px | display |
| Page title ("Today", "Log meal") | 36 px | display |
| Meal title on its screen | 32 px | display, line-height 0.95 |
| Secondary number (kcal left, row kcal) | 26–28 px | display |
| Macro numbers, strip headings | 22–24 px | display |
| Meal title in a row | 19 px | display, tracking −0.02em, line-height 1.05 |
| Body, list titles | 16 px | 500–700 |
| Secondary text | 14 px | 500 |
| Micro-label | 12 px (10–11 px for units under numbers) | 700 uppercase 0.08em |
| Bottom slab caption | 24 px | 700 uppercase, tracking wide |

Units sit next to numbers smaller and muted (`28g`, `72 /160`).

## Spacing and sizes

- **Gutter:** 20 px (`px-5`) left and right inside every band. Bands themselves have no margin.
- **Headers:** `pt-5 pb-4`; bands `pt-4 pb-5`; section strips `pt-4 pb-2`.
- **Touch targets:** never below 44 px. Icon buttons 48 px (`size-12`, tint square), row
  actions 44 px, list rows ≥ 68 px (captures) / ≥ 84 px (meals), the add-more strip 68 px, the
  bottom slab 76 px plus the safe area, the record button 96 px.
- **Column:** one column, capped at `max-w-md` (448 px) and centred on wider screens; bands run
  edge to edge of the column.

## Safe areas and the shell

- `viewport-fit=cover`. The header pads by `env(safe-area-inset-top)`; left/right by the
  side insets.
- **The bottom slab clears the home indicator by growing**, not by floating: its fill extends
  through `env(safe-area-inset-bottom)` so lime (or ink) runs to the physical edge and the
  caption sits above the indicator. Screens without a bottom slab end with a spacer of the inset.
- Standalone PWA: `apple-mobile-web-app-capable`, status bar style `default` with
  `theme-color` per scheme set to the page colour (the status bar blends into the header).

## Status treatments

| Meal status | Row | Label |
|---|---|---|
| `draft` | plain | "Draft", muted; title "Untitled meal" until analysed |
| `queued` | plain | "Queued", muted |
| `analysing` | plain | "Analysing" with a pulsing square, muted |
| `analysed` | plain | "Analysed", muted; kcal on the right |
| `needs_input` | **full lime row** | "Needs input"; "1 question for you"; kcal marked "prelim."; arrow |
| `failed` | **full orange row** | "Failed"; the reason, "Tap to retry."; arrow |

- A meal without numbers shows a muted "—" where the kcal go.
- **Low-confidence items** (#11) get a `lime-soft` row tint, not a badge.
- **Uploads:** a pending capture's row fills with `lime-soft` from the left as it uploads;
  its label says "Uploading 62 %", "Waiting for network" or "Queued"; a refused upload turns the
  row orange with the reason and Retry / Discard.
- Transcription is quiet: "Transcribing…" as the audio row's label, then the transcript's
  first words.

## Component patterns

- **`Band`** (`tone`: `plain` | `ink` | `lime` | `tint` | `orange`): a full-bleed section.
- **`Strip`**: a section header on tint: display title left (22 px), micro-label meta right.
- **`Label`**: the micro-label.
- **`SlabButton`**: a full-width block button, 64 px default, 76 px as the bottom slab;
  tones `lime`, `ink`, `tint`, `ghost`; disabled = tint with muted text (never a dimmed lime).
  `tint` (full-strength text) is an action that is available but doesn't want the user, like
  the meal detail's "Add to this meal".
- **`BottomSlab`**: the sticky footer: an optional tint hint line (why the action waits) above
  one `SlabButton`, padded by the bottom safe area. On the capture screen it is **Analyse**
  (lime when it can be pressed; tint and disabled with nothing captured, while recording, or
  while an upload is refused), "Analyse queued" / "Analysing…" (tint) while it waits or runs,
  "Retry analysis" on a failed meal, and **Re-analyse** on an analysed meal only once something
  new was captured (otherwise no slab).
- **Meal detail's bottom slab** (#11): lime "Answer & re-analyse" / "Correct & re-analyse" /
  "Re-analyse" / "Retry analysis" once there is something for the next analysis; disabled with
  the hint "Answer or skip the question above." while questions are open; tint "Add to this
  meal" otherwise.
- **`Disclosure`**: a collapsible 56 px row on the plain page (uppercase title, muted meta,
  chevron), stacked with dividers; its content mounts only when open, on tint. For what is
  secondary and heavy: captures, revision history, the trace.
- **Question band** (lime, #11): a micro-label count, each question in display 22 px with why
  it matters and its kcal impact in lime-muted, a text field on the page colour, then a true
  black (`lime-foreground`) "Speak answer" button and a ghost "Skip". A recording in place
  replaces the field with a stop square, the timer (display 32 px) and a small level meter.
  Given answers show as quoted text (spoken: play button and transcript) with a remove ✕.
- **Item row**: description bold, grams in display 20 px with a small "g", kcal muted; under it a
  provenance marker (shape, not colour: weighed ■ solid, label ■ half, database □ open,
  estimate ■ faint) and a three-segment confidence meter. Low confidence = `lime-soft` row plus
  the agent's note. A tap opens the source in the row.
- **Trace list** (on tint): tool calls as "**name** input summary" with the duration right and
  "→ result" below, messages under "Agent", thoughts under "Thinking" (muted, clamped), notes
  muted, errors as orange rows; a tap shows the full input/output in a page-colour block.
- **Totals slab** (ink): the hero kcal left with its label, a secondary figure right, then a
  4-column grid (Prot, Fat, Carb, Fibre), and an optional note under a thin `ink-line` divider
  ("■ 1 meal not counted yet": meals without an analysis count nothing, so the totals are never
  misread as the whole day). With the goal in force (#12) the right figure is what's left
  ("1,704 / left of 2,400", in lime), the kcal get a 12 px bar and each target "/160" and a 6 px
  bar; the day view adds "88 left" / "12 over" under each macro. A macro without a target shows
  plain grams and no bar. Without a goal the slab shows the plain numbers; it never shows
  invented goals.
- **Over a target** (#12): a fact, not an alarm, and the same for every target (protein and fibre
  are minimums, so "over" is often good). No red, no orange. The bar rescales so the target sits
  where the lime ends, a 2 px gap in the slab's own colour marks the target, and the excess is
  filled in the slab's foreground (paper on ink, white on charcoal); the right figure becomes
  "+105 / over 2,400" in the foreground instead of lime. Text says "over", so it never relies on
  the fill alone.
- **Day view** (#12): back + the goals button in the header, the date as a micro-label and the
  day ("Today", "Yesterday", "Monday", "Mon 26 Oct") as the page title; the totals slab with
  targets; a plain 56 px goal row ("Goal since 14 Oct · Cut", "Targets →"; "No targets for this
  day"); the day's meals; its weight. The bottom slab is two tint halves stepping to the day
  before and after (the thumb's job on this screen); the next day is disabled on today. Steps
  replace the history entry, so Back leaves the day view.
- **Meal row without numbers** (#12): the muted "—" gets a "not counted" micro-label.
- **Weight entry** (lime, #12): "Weight today" and the last entry as micro-labels, one 72 px
  field on the page colour (display 40 px, `inputMode="decimal"`, a comma works, the last weight
  as placeholder) beside a true-black "Log" (tint and muted while empty), "Now · change time"
  below (a `datetime-local` once tapped); after logging, "Logged 81.4 kg · 07:10" with Undo.
- **Weight trend** (tint, #12): the latest 7-day average in display 40 px, the change over the
  window as a small ink chip ("−2.1 kg / 6 wk"), then a small SVG (no chart library): hairline
  solid gridlines in `--border` with kg labels in a left gutter, raw entries as 5 px muted
  squares, the moving average as a 2.5 px line in the foreground (lime stays for what wants the
  user). A tap or drag reads the nearest entry ("Yesterday 06:59 · 81.7 kg · avg 81.9") in place
  of the date axis.
- **Target fields** (#12): 64 px rows, the name as an uppercase label, a 112 px tint field with
  the number right-aligned in display 28 px (`lime-soft` while focused), the unit muted. A
  changed form brings the bottom slab: ink "Save · from today" (the screen's lime is the weight
  entry), with a tint toggle row above "Fix a typo in the current goal", which turns it into
  "Fix current goal". History is a `Disclosure` of tint rows: the period ("14 Oct – today", "29
  Sept – 13 Oct", "replaced the same day"), a five-column grid of targets, the note, and a small
  ink "In force" chip.
- **Step flow** (#24, the guided setup): one question block per screen. The header has the back
  square (a step back; on the first step it leaves), a micro-label "Guided setup · 2 / 5" on the
  right, the step's title (36 px display), one muted lead line and a progress bar of five 6 px
  segments with 4 px gaps (foreground up to the current step, tint after). The bottom slab is
  lime **Next** (disabled tint with a hint saying what's missing), on the last step **Save · from
  today**. Back keeps every answer. A refusal ("not calculated", under 18, pregnancy) is a tint
  band with a neutral why and takes the slab's place: there is nothing to wait for.
- **Choice rows** (#24): a single choice as full-width plain rows (≥ 72 px, dividers): the title
  bold 17 px, one muted example line, a 28 px check square on the right (filled foreground with a
  ✓ when chosen, tint when not; the same square as the goals screen's "Fix a typo" toggle). The
  row itself stays plain: a tint row would merge with a tint strip above it. A row that isn't
  available is muted, without a square, and says why in its example line.
- **Preset chips** (#24): what the user picks instead of typing a number. Equal cells in one row
  with 2 px gaps of the page colour, tint; the chosen one takes the foreground fill (like the
  switch, never lime: a choice doesn't want the user). The number on top in display 20 px
  ("0.5 %", "2.0"), the preset's name under it as an 11 px micro-label ("Standard", "High");
  64 px tall, 56 px without a number.
- **Stepper** (#24): − and + in 64 px tint squares around the value in display 64 px with its
  unit as a micro-label under it ("3 / sessions a week", "0 / No training"); the ends disable.
- **Slider** (#24, the fat share): a native range input styled square: an 8 px tint track, a
  28 px foreground square thumb, 44 px tall to touch, the stops (20 … 40) as micro-labels under
  it with the current one in the foreground. Presets above it set the same value.
- **Split bar** (#24): the macro split on the ink slab, a 12 px bar with a segment per macro's
  share of the kcal and 2 px gaps in the slab's colour: protein lime, fat paper
  (`ink-foreground`), carbs `ink-muted`, fibre `ink-line`. Under it the 4-column grid of grams with
  a matching 10 px swatch, the name and the percentage, so it never relies on the fills alone.
- **Review of targets** (#24): the ink slab carries the kcal (64 px), maintenance on the right
  (28 px), the change as one muted line ("−440 kcal a day · ≈ 0.4 kg a week"), the split bar and
  the grams. Then a strip per number (Energy, Protein, Fat, Carbs, Fibre; meta "160 g · 24 %"),
  its explanation lines (15 px, medium, foreground: they are content the user reads) and its
  presets right under them. Floors, caps and warnings are a tint band of "■" lines at the end,
  never orange (nothing failed), with the reminder that it's a starting estimate. Every line
  names its formula or source in a few words ("Mifflin-St Jeor (1990)", "5 MET (2024
  Compendium)", "(Helms 2014)"); the formulas in full sit in a closed `Disclosure` "How this is
  calculated" at the end (micro-label per number, the formula and its short citation on tint,
  the starting-estimate sentence, an underlined link to the research report). A goal's "Why
  these targets" ends with the same disclosure, nested under a divider.
- **Guided row** (#24, goals screen): a 72 px row under "Daily targets" with a compass, the
  caption ("Guided setup", or "Recalculate" once a profile exists) and a muted line; **lime**
  while no goal is in force (setting one wants the user), **tint** once there is one. A guided
  goal in force adds a "Why these targets" disclosure (its explanation on tint), and guided goals
  in the history read "Guided · cut, standard pace" with "Why these numbers" to open theirs.
- **Recorder** (ink): the 96 px lime circle (mic / stop square), the timer in display 60 px,
  a level meter of thin vertical bars (lime for the live part, `ink-line` for the rest), and the
  lock note under a thin `ink-line` divider, always visible.
- **Add-more strip**: four equal 68 px targets (Photo, Note, Link, Audio) with an icon over a
  micro-label, separated by vertical dividers; pressed = lime.
- **Capture row**: 48 px tile (photo thumbnail, or an icon on tint), bold title, micro-label
  status, a 44 px remove action. Removing asks once inline ("Remove?") because captures can't be
  un-retracted.
- **Icon buttons** in headers: 48 px tint squares (close ✕, back ←, the scale for goals and
  weight on the overview and the day view, the cog for settings on the overview). Back goes back in the app's history, or to the
  overview when the screen was opened directly.
- **Settings** (#13): back and the page title, then the notification state as the ink slab (the
  bell, "Notifications", the state in display 40 px: On / Off / Blocked / Not installed / Not
  available, one muted line on what it means). Off: a "You'll hear when" strip with the three
  events as plain rows and the lime bottom slab **Turn on notifications**. On: "Notify me when"
  with a switch row per event, a muted "Turn off on this device" row, and a tint bottom slab
  **Send test notification** (its hint says how it went). Not installed: the numbered Add to Home
  Screen steps on tint (number tiles on the page colour, the Share / add / bell icons), and the
  bottom slab disabled with the hint "Add yamt to your Home Screen first." Blocked: where to
  allow it, on tint, no slab. A failed turn on/off is an orange line under the slab.
- **Switch** (#13): a square 56×32 track with a 24 px square knob, 64 px rows; on = foreground
  track with a page-colour knob on the right, off = tint track with a muted knob on the left.
  Never lime: a toggle's state doesn't want the user.
- **Sheets** (note, link): slide in from the **top** (on iOS the keyboard covers the bottom
  half, a bottom sheet would sit behind it), on the page colour, square, display title, the input
  on tint (lime-soft while focused), a lime `SlabButton` to add.
- **Icons:** lucide, stroke width 2.5, 20–28 px.

## Do / don't

- **Do** give each screen exactly one ink slab. If two things feel equally important, one of
  them is secondary: make it tint.
- **Do** use lime only for things that want the user now. A lime element that's just
  decoration teaches the user to ignore lime.
- **Do** keep the main action in the bottom slab, in the flow, clear of the home indicator.
- **Do** use the token classes; add a token to `index.css` (light and dark) before using a new
  colour.
- **Don't** draw outlines, borders around sections, shadows, rounded cards or gaps between
  bands. Dividers are for list rows only.
- **Don't** float anything (FABs, toasts over content). Say it in a band or the bottom slab's
  hint.
- **Don't** use orange for anything but failure, or red at all outside shadcn's destructive.
- **Don't** show fake data: no invented goals, no placeholder numbers; a muted "—" when there is
  nothing yet.
- **Don't** shrink a touch target below 44 px to fit a layout.
