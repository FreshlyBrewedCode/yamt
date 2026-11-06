import { basename } from "node:path";
import {
  type AnalyseResponse,
  type CaptureResponse,
  CreateMealBody,
  JsonCaptureBody,
  type MealDetailResponse,
  type MealResponse,
  type MealRevisionsResponse,
  MealsQuery,
  type MealsResponse,
  type RemoveMealResponse,
  RepeatableQuery,
  type RepeatableResponse,
  RepeatMealBody,
  type RepeatMealResponse,
  type RestoreMealResponse,
  type RetractResponse,
  type TranscribeResponse,
  UpdateMealBody,
  UploadCaptureFields,
} from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";
import { fileResponse } from "./file-response.ts";
import { readJson, readUpload } from "./middleware.ts";

/** Meals, captures and their media (mounted under /api, behind auth). Paths: `mealPaths`. */
export function mealRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.post("/meals", async (c) => {
    const { meal, created } = s.meals.ensure(CreateMealBody.parse(await readJson(c)));
    return c.json<MealResponse>({ meal }, created ? 201 : 200);
  });

  r.get("/meals", (c) => c.json<MealsResponse>(s.meals.list(MealsQuery.parse(c.req.query()))));

  // before /meals/:id, which would take "repeatable" for an id
  r.get("/meals/repeatable", (c) =>
    c.json<RepeatableResponse>(s.meals.repeatable(RepeatableQuery.parse(c.req.query()))),
  );

  r.get("/meals/:id", (c) => c.json<MealDetailResponse>(s.meals.detail(c.req.param("id"))));

  r.patch("/meals/:id", async (c) =>
    c.json<MealResponse>({
      meal: s.meals.update(c.req.param("id"), UpdateMealBody.parse(await readJson(c))),
    }),
  );

  r.get("/meals/:id/revisions", (c) => c.json<MealRevisionsResponse>(s.meals.revisions(c.req.param("id"))));

  r.post("/meals/:id/captures", async (c) => {
    const mealId = c.req.param("id");
    const type = c.req.header("content-type")?.toLowerCase() ?? "";
    if (type.startsWith("multipart/form-data")) {
      const { file, field } = await readUpload(c);
      const fields = UploadCaptureFields.parse({
        id: field("id"),
        kind: field("kind"),
        capturedAt: field("capturedAt"),
        questionId: field("questionId"),
      });
      const { created, ...res } = await s.meals.addUpload(mealId, file, fields);
      return c.json<CaptureResponse>(res, created ? 201 : 200);
    }
    if (type.startsWith("application/json")) {
      const { created, ...res } = s.meals.addJson(mealId, JsonCaptureBody.parse(await readJson(c)));
      return c.json<CaptureResponse>(res, created ? 201 : 200);
    }
    throw new HttpError(
      415,
      "send multipart/form-data (audio, image, file) or JSON (text, link, correction, answer)",
    );
  });

  r.post("/captures/:id/retract", (c) => c.json<RetractResponse>(s.meals.retract(c.req.param("id"))));

  r.post("/captures/:id/transcribe", (c) =>
    c.json<TranscribeResponse>(s.meals.retranscribe(c.req.param("id"))),
  );

  r.post("/meals/:id/repeat", async (c) => {
    const { created, ...res } = s.meals.repeat(c.req.param("id"), RepeatMealBody.parse(await readJson(c)));
    return c.json<RepeatMealResponse>(res, created ? 201 : 200);
  });

  r.post("/meals/:id/analyse", (c) => c.json<AnalyseResponse>(s.meals.analyse(c.req.param("id"))));

  // soft removal and its undo, both idempotent; no body
  r.post("/meals/:id/remove", (c) => c.json<RemoveMealResponse>(s.meals.remove(c.req.param("id"))));
  r.post("/meals/:id/restore", (c) => c.json<RestoreMealResponse>(s.meals.restore(c.req.param("id"))));

  r.get("/media/:captureId", (c) => media(c.req.raw, s, c.req.param("captureId"), "original"));
  r.get("/media/:captureId/jpeg", (c) => media(c.req.raw, s, c.req.param("captureId"), "jpeg"));

  return r;
}

function media(req: Request, s: Services, captureId: string, variant: "original" | "jpeg"): Response {
  const f = s.meals.mediaFile(captureId, variant);
  return fileResponse(req, { ...f, downloadName: basename(f.path) });
}
