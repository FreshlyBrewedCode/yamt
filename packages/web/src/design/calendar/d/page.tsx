// Direction D · Plan: C's heat month as the ink slab, continued downwards by the selected day's
// totals (A's slab) on the same ink, so the screen reads as one ink element (the month and the
// day in it) plus supporting bands: the month summary with the weight line on tint, the legend
// on the page, "Open day" as the bottom slab. Squares say how a day sat against its goal's
// on-plan range (plan.ts): three lime strengths, a cap for the direction, a hollow cap for too
// low; the 8th column is the week.
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Band, BottomSlab, SlabButton } from "@/components/slab";
import { dateStart, dayLabel } from "@/lib/format";
import { NOW } from "../mock";
import { DayRow, DayTotals, Header, Legend, MonthGrid, Summary } from "./parts";

export function CalendarD({
  month,
  day,
  onMonth,
  onDay,
}: {
  month: string;
  day: string;
  onMonth: (m: string) => void;
  onDay: (d: string) => void;
}) {
  const navigate = useNavigate();
  const label = dayLabel(dateStart(day), NOW);
  return (
    <>
      <Header month={month} onMonth={onMonth} />
      <main className="flex-1">
        {/* the one ink element: the month, and the selected day as its continuation */}
        <Band tone="ink" className="px-4 pt-4 pb-4">
          <MonthGrid month={month} day={day} onDay={onDay} surface="ink" />
        </Band>
        <Band tone="ink">
          <DayRow day={day} surface="ink" />
          <DayTotals day={day} className="pt-2" />
        </Band>
        <Summary month={month} />
        <Legend month={month} surface="ink" />
      </main>
      <BottomSlab>
        <SlabButton tone="tint" onClick={() => navigate({ to: "/days/$date", params: { date: day } })}>
          Open {label} <ArrowRight className="size-7" strokeWidth={2.5} />
        </SlabButton>
      </BottomSlab>
    </>
  );
}
