import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarB } from "@/design/calendar/b/page";
import { resolve, validateCalendarSearch } from "@/design/calendar/search";

export const Route = createFileRoute("/design/calendar/b")({
  validateSearch: validateCalendarSearch,
  component: () => {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const { month, day } = resolve(search);
    return (
      <CalendarB
        month={month}
        day={day}
        onMonth={(m) => navigate({ search: { month: m, day }, replace: true })}
        onDay={(d) => navigate({ search: { month, day: d }, replace: true })}
      />
    );
  },
});
