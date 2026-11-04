// The calendar variants keep the shown month and the selected day in the URL, so every state
// has an address (for the screenshots and the contact sheet).
import { LAST_MONTH, TODAY } from "./mock";

export interface CalendarSearch {
  month?: string;
  day?: string;
}

export function validateCalendarSearch(s: Record<string, unknown>): CalendarSearch {
  const out: CalendarSearch = {};
  if (typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month)) out.month = s.month;
  if (typeof s.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.day)) out.day = s.day;
  return out;
}

export const resolve = (s: CalendarSearch) => ({
  day: s.day ?? TODAY,
  month: s.month ?? (s.day ? s.day.slice(0, 7) : LAST_MONTH),
});
