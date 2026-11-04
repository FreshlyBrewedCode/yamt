import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarD } from "@/design/calendar/d/page";
import { resolve, validateCalendarSearch } from "@/design/calendar/search";

export const Route = createFileRoute("/design/calendar/d")({
  validateSearch: validateCalendarSearch,
  component: () => {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const { month, day } = resolve(search);
    return (
      <CalendarD
        month={month}
        day={day}
        onMonth={(m) => navigate({ search: { month: m, day }, replace: true })}
        onDay={(d) => navigate({ search: { month, day: d }, replace: true })}
      />
    );
  },
});
