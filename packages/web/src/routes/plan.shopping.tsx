import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AISLE_NAME, LocalDate, type ShoppingLine, type ShoppingListResponse } from "@yamt/shared";
import { cn } from "cn";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { CaptureSheet, fieldClass } from "@/components/add-strip";
import { CheckSquare, Chips } from "@/components/choice";
import { rangeLabel } from "@/components/leftovers";
import { BackButton, Band, BottomSlab, Label, SlabButton, Strip } from "@/components/slab";
import { formatGrams, formatWeekday, plural } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { slotWords } from "@/lib/plan-request";
import {
  planError,
  useAddShoppingLine,
  useCheckShopping,
  useRemoveShoppingLine,
  useShopping,
} from "@/lib/queries";
import { atHomeWords, byAisle, rangeDays } from "@/lib/shopping";

interface ShoppingSearch {
  from?: string;
  to?: string;
}

export const Route = createFileRoute("/plan/shopping")({
  validateSearch: (s: Record<string, unknown>): ShoppingSearch => ({
    from: LocalDate.safeParse(s.from).success ? (s.from as string) : undefined,
    to: LocalDate.safeParse(s.to).success ? (s.to as string) : undefined,
  }),
  component: ShoppingList,
});

/**
 * The shopping list (#49, G): for a range of the plan's days (default today to the last planned
 * day; the ink slab's "change" opens a sheet with the days as chips), what the planned meals need
 * for the portions cooked, minus the leftovers at home, by aisle. A line's square puts it in the
 * basket; a tap on the line shows which recipes need it. Lines of the user's own: Add a line (the
 * tint bottom slab). Online only: every check is a request.
 */
function ShoppingList() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const list = useShopping(search.from, search.to);
  const [ranging, setRanging] = useState(false);
  const [adding, setAdding] = useState(false);
  const data = list.data;

  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <BackButton fallback="/plan" />
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground">Plan · needs yamt online</Label>
          <h1 className="display mt-1 text-[36px]">Shopping list</h1>
        </div>
      </header>

      <main className="flex-1">
        <Basket data={data} onChange={() => setRanging(true)} />
        {list.isPending && <p className="px-5 py-6 font-medium text-muted-foreground">Loading…</p>}
        {list.isError && (
          <p className="px-5 py-6 font-medium text-muted-foreground" role="alert">
            {planError(list.error, "the shopping list")}
          </p>
        )}
        {data && data.lines.length === 0 && (
          <p className="px-5 py-6 font-medium text-muted-foreground" data-testid="shopping-empty">
            Nothing to buy for {rangeLabel(data.from, data.to)}: no planned meal there needs anything. Plan
            meals, or add a line.
          </p>
        )}
        {data &&
          byAisle(data.lines).map(({ aisle, lines, toBuy, checked }) => (
            <section key={aisle} aria-label={AISLE_NAME[aisle]} data-testid="aisle" data-aisle={aisle}>
              <Strip title={AISLE_NAME[aisle]} meta={`${checked} of ${toBuy}`} />
              <ul className="divide-y divide-border">
                {lines.map((l) => (
                  <Line key={l.key} line={l} list={data} />
                ))}
              </ul>
            </section>
          ))}
      </main>

      <BottomSlab>
        <SlabButton tone="tint" onClick={() => setAdding(true)} disabled={!data} data-testid="add-line">
          <Plus className="size-7" strokeWidth={2.5} /> Add a line
        </SlabButton>
      </BottomSlab>

      {data && (
        <RangeSheet
          open={ranging}
          data={data}
          onClose={() => setRanging(false)}
          onPick={(from, to) => {
            setRanging(false);
            void navigate({ to: "/plan/shopping", search: { from, to }, replace: true });
          }}
        />
      )}
      {data && <AddLineSheet open={adding} data={data} onClose={() => setAdding(false)} />}
    </>
  );
}

/**
 * The ink slab: "2 /15 in the basket" left, the range and "3 recipes · change" right, and what the
 * amounts are under a thin line.
 */
function Basket({ data, onChange }: { data: ShoppingListResponse | undefined; onChange: () => void }) {
  const home = data?.lines.filter((l) => l.covered || l.atHome.length > 0).length ?? 0;
  return (
    <Band tone="ink" className="px-5 pt-4 pb-5" data-testid="basket">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="display text-[64px]" data-testid="in-basket">
              {data?.inBasket ?? "—"}
            </span>
            <span className="display text-[28px] text-ink-muted" data-testid="to-buy">
              /{data?.toBuy ?? "—"}
            </span>
          </div>
          <Label className="mt-2 text-ink-muted">in the basket</Label>
        </div>
        <button
          type="button"
          onClick={onChange}
          disabled={!data}
          className="-mr-1 min-w-0 px-1 pb-1 text-right outline-none focus-visible:underline"
          data-testid="change-range"
        >
          <span className="display block text-[28px]" data-testid="range">
            {data ? rangeLabel(data.from, data.to) : "—"}
          </span>
          <Label className="mt-1 flex items-center justify-end gap-1 text-ink-muted">
            {data ? `${plural(data.meals, "recipe")} · change` : "change"}
            <ChevronRight className="size-3.5" strokeWidth={3} />
          </Label>
        </button>
      </div>
      <Label className="mt-4 border-ink-line border-t pt-3 text-ink-muted">
        Amounts for the portions cooked{home ? ` · ${plural(home, "line")} already at home` : ""}
      </Label>
    </Band>
  );
}

/**
 * A line: the check square, the name (struck once in the basket) with what is at home or "Added by
 * you", the grams to buy in display 20 px; covered by leftovers it is muted without a square. A tap
 * on the name opens which recipes need it (and Remove for one of the user's own).
 */
function Line({ line: l, list }: { line: ShoppingLine; list: ShoppingListResponse }) {
  const check = useCheckShopping();
  const remove = useRemoveShoppingLine();
  const [open, setOpen] = useState(false);
  // the square answers at once; the server's list replaces it
  const checked = check.isPending ? (check.variables?.checked ?? l.checked) : l.checked;
  const sub = l.own ? "Added by you" : atHomeWords(l);
  const error = check.error ?? remove.error;
  return (
    <li data-testid="shopping-line" data-key={l.key} data-checked={checked} data-covered={l.covered}>
      <div className={cn("flex min-h-14 items-stretch", open && "bg-tint")}>
        {l.covered ? (
          <span className="w-[68px] shrink-0" />
        ) : (
          <button
            type="button"
            aria-pressed={checked}
            aria-label={`${checked ? "Out of" : "Into"} the basket: ${l.name}`}
            onClick={() => check.mutate({ from: list.from, to: list.to, key: l.key, checked: !checked })}
            className="flex w-[68px] shrink-0 items-center justify-center outline-none focus-visible:underline"
            data-testid="check"
          >
            <CheckSquare on={checked} className={cn(open && !checked && "bg-background")} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-5 text-left outline-none focus-visible:underline"
          data-testid="line-name"
        >
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block font-bold text-[15px] leading-snug",
                checked && "text-muted-foreground line-through decoration-2",
                l.covered && "font-medium text-muted-foreground",
              )}
            >
              {l.name}
            </span>
            {sub && !l.covered && (
              <span className="block font-medium text-muted-foreground text-xs">{sub}</span>
            )}
          </span>
          {l.covered ? (
            <span className="shrink-0 font-medium text-muted-foreground text-xs">{sub}</span>
          ) : (
            l.grams !== null && (
              <span
                className={cn(
                  "display shrink-0 text-[20px]",
                  checked && "text-muted-foreground line-through",
                )}
              >
                {formatGrams(l.grams)}
                <span className="font-bold text-muted-foreground text-xs">g</span>
              </span>
            )
          )}
        </button>
      </div>
      {open && (
        <div className="bg-tint pb-3 pl-[68px] pr-5" data-testid="line-needs">
          {l.needs.map((n) => (
            <div key={n.plannedMealId} className="flex min-h-7 items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium" title={slotWords(n, list.today)}>
                {n.title}
              </span>
              <span className="shrink-0 font-bold">{formatGrams(n.grams)} g</span>
            </div>
          ))}
          {l.atHome.map((h) => (
            <div
              key={h.leftoverId}
              className="flex min-h-7 items-baseline justify-between gap-3 text-muted-foreground text-sm"
            >
              <span className="font-medium">
                At home · {[h.quantity, h.description].filter(Boolean).join(" ")}
              </span>
              <span className="shrink-0 font-bold">
                {h.grams !== null ? `−${formatGrams(h.grams)} g` : "covers it"}
              </span>
            </div>
          ))}
          {l.own && (
            <button
              type="button"
              onClick={() => remove.mutate(l.key.slice("line:".length))}
              disabled={remove.isPending}
              className="-ml-1 flex min-h-11 items-center gap-2 px-1 font-bold text-sm uppercase tracking-[0.08em] outline-none focus-visible:underline"
              data-testid="remove-line"
            >
              <Trash2 className="size-4" strokeWidth={2.5} /> {remove.isPending ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      )}
      {error && (
        <Label
          className="bg-orange px-5 py-2 text-orange-foreground normal-case tracking-normal"
          role="alert"
        >
          {planError(error, "the shopping list")}
        </Label>
      )}
    </li>
  );
}

/**
 * The range sheet: the plan's days (today to the last planned day, a week at least) as chips,
 * **From** and **Through**; lime "Show Tue–Thu".
 */
function RangeSheet({
  open,
  data,
  onClose,
  onPick,
}: {
  open: boolean;
  data: ShoppingListResponse;
  onClose: () => void;
  onPick: (from: string, to: string) => void;
}) {
  return (
    <CaptureSheet open={open} onClose={onClose} title="Which days" description="Shopping for">
      <RangeForm key={open ? "open" : "closed"} data={data} onPick={onPick} />
    </CaptureSheet>
  );
}

function RangeForm({
  data,
  onPick,
}: {
  data: ShoppingListResponse;
  onPick: (from: string, to: string) => void;
}) {
  const days = rangeDays(data.today, data.lastPlannedDay, data.from, data.to);
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  const chips = days.map((d) => ({
    value: d,
    label: d === data.today ? "Today" : formatWeekday(d),
    sub: String(Number(d.slice(8))),
  }));
  return (
    <div data-testid="range-sheet">
      <div className="px-5 pb-5">
        <Label className="mb-2 text-muted-foreground">From</Label>
        <Chips
          label="From"
          options={chips}
          value={from}
          onChange={(d) => {
            setFrom(d);
            if (to < d) setTo(d);
          }}
        />
        <Label className="mt-4 mb-2 text-muted-foreground">Through</Label>
        <Chips
          label="Through"
          options={chips}
          value={to}
          onChange={(d) => {
            setTo(d);
            if (d < from) setFrom(d);
          }}
        />
      </div>
      <SlabButton onClick={() => onPick(from, to)} data-testid="range-show">
        Show {rangeLabel(from, to)}
      </SlabButton>
    </div>
  );
}

/** Add a line of your own: one text field, lime Add. */
function AddLineSheet({
  open,
  data,
  onClose,
}: {
  open: boolean;
  data: ShoppingListResponse;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [id, setId] = useState(() => uuidv7());
  const add = useAddShoppingLine();
  const close = () => {
    setText("");
    setId(uuidv7());
    add.reset();
    onClose();
  };
  const submit = () => {
    if (!text.trim() || add.isPending) return;
    add.mutate({ id, from: data.from, to: data.to, text: text.trim() }, { onSuccess: close });
  };
  return (
    <CaptureSheet
      open={open}
      onClose={close}
      title="Add a line"
      description={`Shopping for ${rangeLabel(data.from, data.to)}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Limetten (2)"
          aria-label="What to buy"
          maxLength={120}
          enterKeyHint="done"
          className={`${fieldClass} h-16`}
          data-testid="line-text"
        />
        {add.isError && (
          <Label
            className="bg-orange px-5 py-2.5 text-orange-foreground normal-case tracking-normal"
            role="alert"
          >
            {planError(add.error, "adding a line")}
          </Label>
        )}
        <SlabButton type="submit" disabled={!text.trim() || add.isPending}>
          {add.isPending ? "Adding…" : "Add line"}
        </SlabButton>
      </form>
    </CaptureSheet>
  );
}
