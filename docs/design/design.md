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
  meal" otherwise. On an analysed meal (#30) that calm slab is two tint halves like the day
  view's steps: **Add more** (+) and **Log again** (the repeat arrows), 18 px captions, lime while
  pressed. Neither wants the user, so neither is lime.
- **Log again sheet** (#30): the top sheet ("Log again" over the meal's title), a micro-label with
  the source's time and kcal and one muted line ("Its items are copied, scaled to the portion: no
  new analysis."), "Portion" preset chips 0.5× / 1× / 1.5× / 2× with Half / Same / More / Double
  (1× chosen), "Now · change time" (a `datetime-local` once tapped, like the weight entry) with
  the portion's kcal on the right (display 28 px, "≈" unless 1×), then the lime **Log again**. A
  failure is an orange line above the button ("No connection: logging a meal again needs yamt.
  Try again once you're online."): it is one request, never queued.
- **Again?** (#30, Log meal): before anything is captured, under the empty captures, a strip
  "Again?" (meta "last 30 days") and up to five plain 68 px rows: the title (display 19 px), a
  muted line ("4× in 30 days · Today, 08:15"), the kcal right (display 26 px over a "kcal"
  label). A tap opens the Log again sheet. Nothing shows when there is nothing to offer.
- **Logged again from** (#30, meal detail header): under the title and summary, a muted 14 px
  line with the repeat icon, "Logged again from **Cappuccino** · Yesterday, 08:15" (the title
  bold, underlined, in the foreground), linking to the source. The overview's row for such a
  meal says "Logged again" where others list their captures; its trace row's meta is "no
  analysis", opening to a tint line that says why.
- **Split slab** (#40, the overview): the bottom slab in two, **Log** (lime, + icon, flex) | **Plan**
  (tint, the chef's hat, 42 %), 24 px captions. Planning is available but doesn't want the user;
  the totals slab stays the screen's only ink. Plan opens the planning entry screen (#47).
- **Planned-meal row** (#40, the overview's and the day view's list, the plan view): a plain 84 px
  row like a meal row, but quiet: "Planned · Dinner" (chef's hat, micro-label, muted) where the
  time and status sit, the title in the muted foreground, "Cook 2 · eat 1" under it, the kcal muted
  with "planned" under them. Where it can be eaten (today or earlier) a 64 px wide tint **Ate it**
  square (check over a micro-label) fills the row's right edge, lime while pressed. On the overview
  and the day view it follows the eaten meals; logged and skipped ones leave those lists. In the
  plan view a logged one reads "Logged · Dinner" (check icon, the title in the foreground, its
  meal's kcal), a skipped one "Skipped · Dinner", struck through, "Not counted".
- **"With it" note** (#40): the totals slab's note gains a line with the chef's hat, "1 planned · with it 1,971 of
  2,200 · 229 left" (or "… over", or "with it 1,971 kcal" without a target) while the day has
  planned meals to log; the slab's note takes several lines, each its own row.
- **Plan squares** (#40, the plan view's ink slab): today and the next six days in a 4-column grid
  of 88 px squares (4 px gaps, 12 px side padding): the date chip top left (today's filled like the
  calendar's), the short weekday top right, the projected kcal (display 20 px) and the reading as a
  10 px micro-label at the bottom ("on plan, under", "rest open", "nothing planned"). The fills and
  caps are the calendar's, but only for a mostly known day; one still open is `ink-line` grey, an
  empty one `ink-line` at 40 % with "—". One plain line under the grid on the slab says what the
  squares are read against ("Read against Cut, standard pace once a day is mostly known …").
- **Recipe detail** (#40): a recipe to cook from. The header label says the plan ("Planned · Today,
  dinner · cook 2, eat 1"), the title in display 32 px, the summary muted, the source as a
  micro-label with a globe (sparkles for "Composed for you"), a link when it has a URL. The ink slab
  is the dish against its day: the kcal of the portion eaten (64 px), what is open of the day's kcal
  target on the right in lime (28 px, "open today"), the **fit bar** (12 px: the day's other eaten
  and planned kcal in lime, this dish in the slab's foreground, past the target after a 2 px gap at
  60 %), the macros with "/open" and a 6 px bar each, the times under a thin line. Changes against
  the source ("Changed against chefkoch.de", small hollow squares), notes and the planned meal's
  note on tint. A "Portions" strip with **Cook** (1–4) and **Eat** (0.5×–2×) preset chips side by
  side and the leftover sentence with the fork-and-knife icon; ingredients as plain rows (bold
  description, "optional" muted, grams in display 20 px) for the portions cooked; steps as rows with
  a 32 px tint number tile; the source footer on tint (the link, and that the nutrition comes from
  the matched ingredients, never from the page). The bottom slab: lime **Ate it** when due, tint
  **Change day · portions** ahead of time (also the header's calendar-clock square), tint
  **Unskip** for a skipped one (a tint band says it counts nowhere), tint **Open the logged meal**.
- **Ate-it sheet** (#40, the top sheet, capped at the screen's height and scrolling): "Ate it ·
  Today, dinner" over the title, one muted line ("Logged as a meal with these items, scaled to the
  portion: no analysis. Switch off what you left out."), the items as 48 px check rows between
  dividers (the 28 px check square, bold description, grams in display 18 px; off = tint square and
  struck through, muted), then "Portion · of 2 cooked" with 0.5× Half / 1× As planned / 1.5× More /
  2× Double, the leftover line, "Now · change time" with the kcal (display 28 px) and a line of
  macro grams, and the lime **Log it**. Everything off disables it with a tint hint; a failure is an
  orange line above it.
- **Plan-for sheet** (#40, top sheet, "Plan for" over the title): Day chips (number over the
  weekday, "Today" for today; seven wrap into 4 + 3), Slot chips (labels only), Cook / Eat chips, a
  plain 15 px line when the slot already holds a meal ("Monday's dinner already has …. Both stay
  planned.": a fact, not a warning colour), "<day> with it · 1,784 of 2,200 · 416 left", the lime
  **Save · Mon dinner** (disabled until something changed), then two plain 56 px rows: **Skip it**
  (what it means in a muted line, the skip icon) and **Unplan** (the trash icon; an inline confirm
  with a foreground "Unplan" block, falling back after 4 s, like Remove meal).
- **Logged from the plan** (#40, meal detail header): like "Logged again from", a muted 14 px line
  with the chef's hat, "Logged from the plan · **Today, dinner**" linking to the planned meal; the
  overview's row says "From the plan" where Log again's says "Logged again"; the revision history
  says "logged from the plan".
- **Planning strip** (#47, the overview, under the totals): a "Planning" strip (meta "2 requests")
  and **at most one 84 px row per state** (#54's follow-up), built like a meal row: a single request
  whose suggestions wait for a verdict is a **full lime row** ("Suggested · 2 for you" with sparkles,
  the title in display 19 px, "Pick or steer · round 1 · 15:58" in lime-muted, an arrow), one still
  suggesting is quiet ("Suggesting · 2 of 3 ready" with the pulsing square, the title muted, the
  ready count in display 26 px over "of 3"), a failed round a **full orange row**. Several requests
  sharing a state fold into one row of the same colour instead: "Suggested" over the count in words
  ("3 requests with suggestions"), their titles in the sub-line ("Dinner Fri · Lunch Sat · …",
  truncated), an arrow to the entry screen, where every open request is listed. A request still in
  the upload queue is a quiet row ("On this phone · waiting to send"), never folded. A request whose
  filter days are all in the past drops off the strip (it stays on the entry screen until archived).
  Nothing wants anything: no strip.
- **Starter band** (#47, the planning entry): an idea as a full-width band: its number on the left in
  display 36 px (56 px on the ink slab) over what it is as a 10 px micro-label ("g protein open
  tonight", "logged in 30 days", "Kürbis, Grünkohl, Rosenkohl, Birnen"), the idea in display 19 px
  (24 px on ink) with one muted why-line, an arrow. The first starter is the entry screen's ink slab,
  the rest alternate tint and plain, separated by dividers. Only starters with real data show
  (no goal, no "protein open"); a tap fills the composer and the filters, never sends.
- **Filter summary + composer dock** (#47, the planning entry and the request thread): the sticky
  footer on the page colour. Above the composer on the entry screen a 48 px tint row: "For" as a
  muted micro-label, the filters in bold 14 px joined by " · " ("Tonight · Dinner · ≤ 30 min · cook
  2", only what differs from the defaults after when and which meals), a chevron; it opens the filter
  page. A tint hint above it when the request can't go yet ("Pick a day in the filters."). The
  composer: attachments as 44 px tint chips in a sideways-scrolling row (a photo's thumbnail or an
  icon tile, the name bold, a 10 px micro-label "voice · transcribed later", a ✕), then a row of
  48 px squares with 2 px gaps: **plus** (tint), the field (tint, lime-soft while focused, 16 px,
  growing to five lines), the **mic** (tint; recording: lime with a stop square, and the field turns
  into a lime-soft "● Recording 0:04" row), the **send** square (lime with sparkles once there is
  something to send, else tint and muted). The keyboard never hides the dock: it rides on top of it.
  In the thread the dock is the composer alone, with one muted line under it after a finished round
  ("Pick above, steer here, or ask for more: a round takes minutes.").
- **Attach sheet** (#47): the top sheet "Attach" over "To this request", plain 68 px rows with a
  48 px tint icon tile, the name bold and a muted line: Photo, Link, File, Audio file, Paste.
- **Filter page** (#47): the ink slab is the request **as the agent reads it**, one sentence pair
  in display 24 px, "Plus what you type, say and attach · your goal, recent meals and preferences"
  as a muted micro-label under an `ink-line` divider. Then groups of **toggle chips** (a micro-label,
  44 px chips wrapping with 2 px gaps, tint, the chosen ones in the foreground fill with a check:
  a choice, not lime): When (with the next seven days as 60 px chips once "Pick days" is chosen),
  Which meals, Time, Only, Use up (the typed ones as chosen chips, a tint field to add one). A
  "Recipes" strip (meta "default · based on a real recipe") with choice rows, a "Portions" strip
  with preset chips for Cook and Suggestions per round (the default chip says "default"). The lime
  bottom slab **Done**; "Back to the defaults" as a plain 56 px row when something changed.
- **Slots slab** (#47, the request thread's ink slab): the request's days × slots in a 3-column grid
  of 92 px cells (4 px gaps, 12 px side padding): the day and the slot as micro-labels on top, then
  the dish in display 15 px and a 10 px line. A slot this request's pick fills takes the slab's
  foreground ("1,971 with it"); one already eaten or planned otherwise shows that title on
  `ink-line` at 40 %; an open one says "Open" and what the day has eaten. Under it, "1 of 3 slots
  filled · a pick takes its proposed slot, else the next open one".
- **You asked / You added** (#47): a tint band with the display 22 px title and a micro-label meta
  ("Round 1 · 15:41", "for the next round"), the filters as page-colour chips (bold 13 px; the
  first band only), the inputs as 15 px lines with a muted icon (texts and transcripts in quotes,
  "· Text", "· Voice · 0:06", "· Link"); an input still in the upload queue adds "· Sending", "·
  Waiting for network"; a refused one gets an orange line with Retry and Discard.
- **Suggestion band** (#47): a ready suggestion as a full-width plain band: the title in display
  22 px with its summary muted, the kcal per portion right (display 28 px, "kcal / portion"); the
  **fit bar** on the page colour (the day's eaten and planned kcal in lime, this dish in the
  foreground, past the target after a 2 px gap in the band's colour), "Sat with it" against "1,865 of
  2,200 · 335 left"; the macros as small tint chips ("35 g P") and "35 of 88 g P open"; two why-lines
  with filled squares; the times and the source label as one micro-label line. Then **Pick · Sat
  dinner** in ink (available, but the screen doesn't need it: never lime) and a 96 px tint **No**.
  No folds the band into a 48 px muted line "Title · no" with an underlined Undo; a picked band turns
  tint, "Planned · Sat dinner" above the title, with two page-colour buttons **Change day ·
  portions** and **Unplan**. Without a goal there is no bar and no "open" (nothing invented).
- **Placeholder row** (#47): an outlined idea before the agent completes it, all muted: the title and
  approach like a suggestion's, "—" for the kcal, a 12 px grey bar (the foreground at 8 %) where the
  fit bar will be, then "Checking ingredients…" with a pulsing square on the one being worked on, else
  "Queued", the source mode, and the proposed slot on the right. Under a running round a muted
  paragraph says how a round works and that additions go into the next round.
- **Couldn't-complete row** (#47): an idea that failed: title struck through (2 px), approach and
  "—" muted, then a 15 px line with a hollow square, "**Couldn't complete.**" and the reason. Never
  orange: only a round that failed as a whole gets an orange band (its error, "Try again below").
- **Suggest more row** (#47, the end of a finished round): a 64 px full-width tint row with sparkles,
  "SUGGEST MORE" and "same request · 3 more" as meta ("Try again" after a failed round); lime
  **Suggest with it** ("1 addition") while additions wait for a round; a muted line while a round
  waits in the upload queue. Under it a plain 56 px "Archive request" row (muted line, archive icon).
- **Suggestion detail** (#47): the recipe detail in suggestion mode: "Suggestion · round 1 · for Sat,
  dinner" as the header label, the ink slab for one portion against its day, "Why it fits" first on
  the tint band, the ingredients for the request's portions; the bottom slab **Pick · Sat dinner**
  in ink, tint **Undo No** for a rejected one, tint **Open the planned meal** once picked.
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
- **Calendar** (#33, spike #31's D · Plan): back and the month steps (‹ ›, › disabled on the
  current month) in the header, "Calendar · 2026" and the month as the page title. The month is
  the screen's ink slab and the selected day continues it on the same ink, so the screen reads as
  one ink element: a day row (the day's name, "4 Nov" muted when within the week; "Cut, standard
  pace · 3 meals" as a micro-label; "Open day →"), then the totals slab with left / over per
  target, "■ 1 meal not counted yet" and the day's plan reading ("Far off, over") in its note.
  Then the month so far on tint ("So far this month" / the month's name, "12 of 18 days"; % of
  the kcal target, average kcal "/2,100", average protein "/160" in display 26 px; the 7-day weight
  average as a small line, the days' weights as 4 px squares, "82.6 → 81.4 kg"), the legend on the
  plain page, and **Open <day>** as a tint bottom slab (it doesn't want the user).
- **Month grid** (#33): weekday micro-labels, seven day columns and an 8th week column ("Wk")
  after a 4 px extra gap; 4 px gaps, 12 px side padding, so the day squares are 44 px wide at 390
  (48 px tall) and the week column 24 px. A day square shows its number (13 px bold) top left in
  a 22 px chip; today's chip is filled in the slab's foreground. Days of the neighbouring months
  are blank; the future is the "nothing logged" fill with a faded number and can't be tapped.
  The selected day gets a 3 px inset frame in the slab's foreground (its caps move inside it).
  The week square isn't tappable.
- **Plan fades** (#33): how a day sat against the goal in force: full **lime** on plan (the
  range per goal kind: cut −15 % … +5 %, maintain and targets set by hand ±10 %, bulk
  −5 % … +15 %), **lime at 55 %** just off (outside the range, within ±25 %), **lime at 25 %**
  (35 % in dark) far off. Lime here is the reading, not a call to act: the squares are the
  slab's content, and the fades keep the helpful direction lime longer. No yellow-to-red, no
  orange: a single day's ±10–20 % estimation error doesn't deserve an alarm. Days without a goal
  (or a kcal target) are `ink-line` grey with the kcal in thousands bottom right ("2.4k", muted);
  meals not analysed yet add an 8 px square bottom right on the same grey (or on the fade, when
  part of the day counts); nothing logged is `ink-line` at 40 %.
- **Caps** (#33): the direction as a 4 px bar in the slab's foreground across the square, on top
  for over and at the bottom for under, only outside ±5 %. **Too low** (under the goal's calorie
  floor, or more than 25 % under on a cut) is a hollow 7 px bottom cap (a 2 px outline), never a
  colour. The words say the same ("on plan", "just off", "far off", "over", "under", "too low");
  no streaks, no judgement.
- **Week column** (#33): the week (Monday to Sunday, neighbouring months' days included) in the
  same fades and caps, from the mean of its counted days' shares of their own targets, judged by
  the goal in force on its last counted day; its count (11 px bold) in the middle while fewer than
  four days counted; blank for weeks wholly in the future.
- **Legend** (#33, "Reading the month", display 22 px on the plain page): the ranges in force
  that month as bold sentences generated from the goals ("From 14 Oct: Cut, standard pace, on plan
  from 15 % under to 5 % over the kcal target."; "Until 6 Sept: no goal, kcal only."; "No goal this
  month: the squares show kcal only."), then one row per mark: a 28 px swatch cut from the ink slab
  (so it looks like a square) and a muted 14 px line. The plan rows show only when a goal with a
  kcal target applied that month, the kcal-only row only when a day had none; the numbers come from
  the classifier's constants.
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
- **Add-more strip**: five equal 68 px targets (Photo, Note, Link, Audio, Paste; 78 px wide at
  390) with an icon over a micro-label, separated by vertical dividers; pressed = lime.
- **Capture row**: 48 px tile (photo thumbnail, or an icon on tint), bold title, micro-label
  status, a 44 px remove action. Removing asks once inline ("Remove?") because captures can't be
  un-retracted.
- **Remove meal row**: the last row of a meal's screen (the detail, after the collapsed rows; the
  capture view, after its captures), a 56 px plain row like a `Disclosure`'s: "Remove meal" in the
  same uppercase and a muted trash icon on the right. A tap asks once inline, like a capture: the
  row says "Remove meal?" with one muted 14 px line on what happens ("Its analysis stops." when one
  is queued or running, "It leaves its day and the totals; you can undo it.") and the 44 px
  foreground "Remove" block where the icon was; it falls back after 4 s. While captures of the meal
  are still in the upload queue the row is muted and says to wait for them or discard them. A
  failure is an orange line under the row. Never lime or orange as a fill: removing doesn't want
  the user, and nothing failed.
- **Undo strip** (day view, right after a removal): a tint band at the top of the content, above
  the totals slab: "Meal removed" as a micro-label over the meal's title (bold), and a 44 px
  foreground **Undo** block (with the undo arrow) on the right. Quiet, not a toast: it is part of
  the page and pushes the slab down, and goes by itself after 12 s, on Undo or when the user moves
  on.
- **Removed meal** (a removed meal opened directly): the header with a tint "Removed" chip where
  the status sits, the time and the title muted; a tint band ("Removed Today, 22:29", that it
  isn't counted anywhere and nothing was deleted); the numbers as the ink slab labelled "kcal · not
  counted" with "■ Removed: in no day's totals" in its note, the items; **Restore meal** as a tint
  bottom slab (available, but it doesn't want the user).
- **Icon buttons** in headers: 48 px tint squares (close ✕, back ←, the calendar on the overview
  and the day view (#33), the scale for goals and weight on the overview and the day view, the
  cog for settings on the overview; the calendar's ‹ › month steps). Back goes back in the app's history, or to the
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
- **Paste sheet** (#26): the same top sheet ("From the clipboard", "Paste"), but the action *is*
  the input: a lime paste target (≥ 144 px, the clipboard icon over "Touch and hold here, then
  Paste", no caret, no ring) that takes no typing, only a paste, which adds at once and closes the
  sheet. Under it one quiet tint line says why the sheet opened (the Paste button wasn't allowed,
  isn't available, or found nothing usable, with what it saw). A paste of nothing usable turns
  that line into an orange one: "Nothing usable on the clipboard." and "It had: <the types>".
- **Share setup** (#26, Settings, after notifications): a strip "Share from other apps" (meta "iOS
  Shortcut"), one plain paragraph on what happens, a plain row with the URL (micro-label, bold
  15 px, breaking anywhere) and a 48 px tint copy square (a check once copied), the five steps on
  tint (number tiles on the page colour, like the Add to Home Screen steps; the Shortcuts app's
  labels in bold, its ⓘ as the lucide info icon), then the paste route as a plain line with the
  clipboard icon.
- **Agent** (#28, Settings, between notifications and sharing): a strip "Agent" (meta "meal
  analysis"), one plain paragraph, then three parts, each headed by a micro-label with where its
  value comes from on the right ("Set here", "From config.json", "Default", "Fixed by
  YAMT_ANALYSIS_MODEL"): **Harness** as choice rows (the chosen one names the running agent and
  its version; one that isn't installed is muted and says why; all disabled with the chosen
  check kept when the env fixes it), **Model** as one 72 px plain row (the model's label in bold
  17 px, its description or "… own default" muted, the number of models and a chevron) that opens
  the model picker, **Effort** as preset chips of the harness's values (more than five wrap into
  two rows of equal cells; "Fake Tiny has no effort setting." as a muted line when there are none).
  Then a plain Refresh row (the icon, "Refresh options", "Read 4 min ago" as a micro-label).
  Loading is one muted line ("Asking Claude Code for its models…"); a harness that can't be asked
  is an orange band with the reason in bold and how to fix it. Changing anything saves at once:
  there is no bottom slab for it.
- **Model picker** (#28): the top sheet ("Claude Code · 13 models", "Model"), with a search field
  (tint, lime-soft while focused, focused at once) only above 15 models, then choice rows by label
  with the description or id muted; groups (OpenCode's providers) get a tint micro-label row
  above their rows and drop the provider from each name. At most 80 rows render, with "N more:
  search to narrow them down." under them. A tap picks and closes.
- **Choice rows fixed elsewhere** (#28): a disabled row keeps its check square if it is the chosen
  one; disabled preset chips keep the chosen fill and mute the rest.
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
