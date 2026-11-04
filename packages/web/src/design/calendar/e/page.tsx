// Direction E · Plan, day first: the same encoding as D, but the ink goes to the selected day's
// totals (as on the overview) and the month sits above it on tint, lime squares on the quiet
// band. Tests whether the three lime strengths and the caps survive on a light surface.
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Band, BottomSlab, SlabButton } from "@/components/slab";
import { dateStart, dayLabel } from "@/lib/format";
import { DayRow, DayTotals, Header, Legend, MonthGrid, Summary } from "../d/parts";
import { NOW } from "../mock";

export function CalendarE({
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
        <Band tone="tint" className="px-4 pt-4 pb-4">
          <MonthGrid month={month} day={day} onDay={onDay} surface="tint" />
        </Band>
        <DayRow day={day} surface="tint" />
        {/* the one ink element: the selected day */}
        <DayTotals day={day} />
        <Summary month={month} />
        <Legend month={month} surface="tint" />
      </main>
      <BottomSlab>
        <SlabButton tone="tint" onClick={() => navigate({ to: "/days/$date", params: { date: day } })}>
          Open {label} <ArrowRight className="size-7" strokeWidth={2.5} />
        </SlabButton>
      </BottomSlab>
    </>
  );
}
