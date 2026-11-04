import {
  CreateGoalBody,
  CurrentGoalQuery,
  type CurrentGoalResponse,
  DayQuery,
  type DayResponse,
  FixGoalBody,
  type GoalResponse,
  type GoalsResponse,
  GuidedGoalBody,
  LocalDate,
  LocalMonth,
  MonthQuery,
  type MonthResponse,
  ProfileBody,
  type ProfileResponse,
} from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** Goals, guided goals, the profile, days and months (mounted under /api, behind auth). Paths: `goalPaths`, `profilePaths`. */
export function goalRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.get("/goals", (c) => c.json<GoalsResponse>({ goals: s.goals.list() }));

  r.post("/goals", async (c) =>
    c.json<GoalResponse>({ goal: s.goals.create(CreateGoalBody.parse(await readJson(c))) }, 201),
  );

  // a guided goal (#24): calculated here from the profile, the choices and the weight log
  r.post("/goals/guided", async (c) =>
    c.json<GoalResponse>({ goal: s.goals.guided(GuidedGoalBody.parse(await readJson(c))) }, 201),
  );

  r.get("/profile", (c) => c.json<ProfileResponse>({ profile: s.repos.profile.get() }));

  r.put("/profile", async (c) =>
    c.json<ProfileResponse>({ profile: s.repos.profile.put(ProfileBody.parse(await readJson(c))) }),
  );

  r.get("/goals/current", (c) =>
    c.json<CurrentGoalResponse>(s.goals.current(CurrentGoalQuery.parse(c.req.query()))),
  );

  r.patch("/goals/:id", async (c) =>
    c.json<GoalResponse>({ goal: s.goals.fix(c.req.param("id"), FixGoalBody.parse(await readJson(c))) }),
  );

  r.get("/days/:date", (c) => {
    const date = LocalDate.safeParse(c.req.param("date"));
    if (!date.success) throw new HttpError(400, "date: expected YYYY-MM-DD");
    return c.json<DayResponse>(s.goals.day(date.data, DayQuery.parse(c.req.query()).tz));
  });

  // the calendar (#33): a month of days against their goals, in one pass
  r.get("/months/:month", (c) => {
    const month = LocalMonth.safeParse(c.req.param("month"));
    if (!month.success) throw new HttpError(400, "month: expected YYYY-MM");
    return c.json<MonthResponse>(s.calendar.month(month.data, MonthQuery.parse(c.req.query()).tz));
  });

  return r;
}
