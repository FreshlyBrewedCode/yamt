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
   | **ink slab** | the one thing that matters on this screen (one per screen) | today's totals, the recorder, a meal's numbers |
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
  tones `lime`, `ink`, `ghost`; disabled = tint with muted text (never a dimmed lime).
- **`BottomSlab`**: the sticky footer: an optional tint hint line (why the action waits) above
  one `SlabButton`, padded by the bottom safe area. On the capture screen it is **Analyse**
  (lime when it can be pressed; tint and disabled with nothing captured, while recording, or
  while an upload is refused), "Analyse queued" / "Analysing…" (tint) while it waits or runs,
  "Retry analysis" on a failed meal, and **Re-analyse** on an analysed meal only once something
  new was captured (otherwise no slab).
- **Totals slab** (ink): the hero kcal left with its label, a secondary figure right, then a
  4-column grid (Prot, Fat, Carb, Fibre). #12 adds targets: the right figure becomes "left of
  2,400" in lime, each macro gets "/160" and a 6 px bar (track `ink-line`, fill lime). Without
  targets the slab shows the plain numbers; it never shows invented goals.
- **Recorder** (ink): the 96 px lime circle (mic / stop square), the timer in display 60 px,
  a level meter of thin vertical bars (lime for the live part, `ink-line` for the rest), and the
  lock note under a thin `ink-line` divider, always visible.
- **Add-more strip**: four equal 68 px targets (Photo, Note, Link, Audio) with an icon over a
  micro-label, separated by vertical dividers; pressed = lime.
- **Capture row**: 48 px tile (photo thumbnail, or an icon on tint), bold title, micro-label
  status, a 44 px remove action. Removing asks once inline ("Remove?") because captures can't be
  un-retracted.
- **Icon buttons** in headers: 48 px tint squares (close ✕, back ←).
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
