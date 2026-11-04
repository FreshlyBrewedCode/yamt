import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addMonths, LocalDate, LocalMonth, monthDays } from "@yamt/shared";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Legend, MonthGrid, MonthSummary, SelectedDay } from "@/components/calendar";
import { BackButton, BottomSlab, iconButtonClass, Label, SlabButton } from "@/components/slab";
import { dateStart, dayLabel, formatMonth, localDate, monthOf } from "@/lib/format";
import { useMonth } from "@/lib/queries";

/** `?month=YYYY-MM&day=YYYY-MM-DD`: every state of the calendar has an address. */
interface CalendarSearch {
  month?: string;
  day?: string;
}

export const Route = createFileRoute("/calendar")({
  validateSearch: (s: Record<string, unknown>): CalendarSearch => ({
    month: LocalMonth.safeParse(s.month).success ? (s.month as string) : undefined,
    day: LocalDate.safeParse(s.day).success ? (s.day as string) : undefined,
  }),
  component: Calendar,
});

/**
 * What is shown: the month (never after the current one; the selected day's by default) and the
 * selected day in it (the given one if it lies in the month and isn't in the future; else today
 * in the current month, a past month's last day).
 */
export function resolveCalendar(search: CalendarSearch, today: string): { month: string; day: string } {
  const current = monthOf(today);
  let month = search.month ?? (search.day ? monthOf(search.day) : current);
  if (month > current) month = current;
  const last = `${month}-${String(monthDays(month)).padStart(2, "0")}`;
  const day =
    search.day && monthOf(search.day) === month && search.day <= today
      ? search.day
      : month === current
        ? today
        : last;
  return { month, day };
}

/**
 * The calendar (#33, D · Plan): the month on the ink slab with the week column, the selected day
 * continuing the ink (its row and totals), the month so far on tint, the legend in words, and
 * "Open <day>" as the bottom slab. Stepping months and picking days replace the history entry,
 * so Back leaves the calendar.
 */
function Calendar() {
  const navigate = useNavigate({ from: Route.fullPath });
  const now = Date.now();
  const today = localDate(now);
  const { month, day } = resolveCalendar(Route.useSearch(), today);
  const data = useMonth(month);
  const shown = data.data?.month === month ? data.data : undefined;
  const current = month === monthOf(today);
  const go = (search: CalendarSearch) => navigate({ search, replace: true });
  const step = (n: number) => go({ month: addMonths(month, n) });

  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={`Previous month: ${formatMonth(addMonths(month, -1))}`}
              className={iconButtonClass}
              data-testid="month-prev"
            >
              <ChevronLeft className="size-6" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={current}
              aria-label={`Next month: ${formatMonth(addMonths(month, 1))}`}
              className={`${iconButtonClass} disabled:text-muted-foreground/40`}
              data-testid="month-next"
            >
              <ChevronRight className="size-6" strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <Label className="mt-4 text-muted-foreground">Calendar · {month.slice(0, 4)}</Label>
        <h1 className="display mt-1 text-[36px]" data-testid="calendar-title">
          {formatMonth(month)}
        </h1>
      </header>

      <main className="flex-1">
        {/* the one ink element: the month, and the selected day as its continuation */}
        <MonthGrid
          month={month}
          data={shown}
          today={today}
          selected={day}
          onSelect={(d) => go({ month, day: d })}
        />
        <SelectedDay day={shown?.days.find((d) => d.date === day)} today={today} now={now} />
        <MonthSummary month={month} data={shown} current={current} error={data.isError} />
        <Legend data={shown} />
      </main>

      <BottomSlab>
        <SlabButton
          tone="tint"
          onClick={() => navigate({ to: "/days/$date", params: { date: day } })}
          data-testid="open-day"
        >
          Open {dayLabel(dateStart(day), now)} <ArrowRight className="size-7" strokeWidth={2.5} />
        </SlabButton>
      </BottomSlab>
    </>
  );
}
