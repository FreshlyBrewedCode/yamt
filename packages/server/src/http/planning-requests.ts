import { basename } from "node:path";
import {
  CreatePlanningRequestBody,
  PickSuggestionBody,
  type PickSuggestionResponse,
  PlanningInputJsonBody,
  type PlanningInputResponse,
  type PlanningRequestDetail,
  type PlanningRequestResponse,
  type PlanningRequestsResponse,
  PlanningUploadFields,
  type RetractPlanningInputResponse,
  StartRoundBody,
  type StartRoundResponse,
  type SuggestionResponse,
} from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";
import { fileResponse } from "./file-response.ts";
import { readJson, readUpload } from "./middleware.ts";

/**
 * Planning requests, their inputs, rounds and suggestions (#44; mounted under /api, behind auth).
 * Paths: `planningRequestPaths`.
 */
export function planningRequestRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();
  const svc = s.planningRequests;

  r.post("/planning/requests", async (c) => {
    const { request, created } = svc.create(CreatePlanningRequestBody.parse(await readJson(c)));
    return c.json<PlanningRequestResponse>({ request }, created ? 201 : 200);
  });

  r.get("/planning/requests", (c) => c.json<PlanningRequestsResponse>(svc.list()));

  r.get("/planning/requests/:id", (c) => c.json<PlanningRequestDetail>(svc.detail(c.req.param("id"))));

  r.post("/planning/requests/:id/archive", (c) =>
    c.json<PlanningRequestResponse>({ request: svc.archive(c.req.param("id")) }),
  );
  r.post("/planning/requests/:id/unarchive", (c) =>
    c.json<PlanningRequestResponse>({ request: svc.unarchive(c.req.param("id")) }),
  );

  r.post("/planning/requests/:id/inputs", async (c) => {
    const requestId = c.req.param("id");
    const type = c.req.header("content-type")?.toLowerCase() ?? "";
    if (type.startsWith("multipart/form-data")) {
      const { file, field } = await readUpload(c);
      const fields = PlanningUploadFields.parse({
        id: field("id"),
        kind: field("kind"),
        capturedAt: field("capturedAt"),
      });
      const { created, ...res } = await svc.addUpload(requestId, file, fields);
      return c.json<PlanningInputResponse>(res, created ? 201 : 200);
    }
    if (type.startsWith("application/json")) {
      const { created, ...res } = svc.addJson(requestId, PlanningInputJsonBody.parse(await readJson(c)));
      return c.json<PlanningInputResponse>(res, created ? 201 : 200);
    }
    throw new HttpError(415, "send multipart/form-data (audio, image, file) or JSON (text, link)");
  });

  r.post("/planning/inputs/:id/retract", (c) =>
    c.json<RetractPlanningInputResponse>(svc.retract(c.req.param("id"))),
  );

  r.post("/planning/requests/:id/suggest", async (c) => {
    const { created, ...res } = svc.suggest(c.req.param("id"), StartRoundBody.parse(await readJson(c)));
    return c.json<StartRoundResponse>(res, created ? 201 : 200);
  });
  r.post("/planning/requests/:id/more", async (c) => {
    const { created, ...res } = svc.more(c.req.param("id"), StartRoundBody.parse(await readJson(c)));
    return c.json<StartRoundResponse>(res, created ? 201 : 200);
  });

  r.post("/planning/suggestions/:id/pick", async (c) => {
    const { created, ...res } = svc.pick(c.req.param("id"), PickSuggestionBody.parse(await readJson(c)));
    return c.json<PickSuggestionResponse>(res, created ? 201 : 200);
  });
  r.post("/planning/suggestions/:id/reject", (c) =>
    c.json<SuggestionResponse>({ suggestion: svc.reject(c.req.param("id")) }),
  );
  r.post("/planning/suggestions/:id/unreject", (c) =>
    c.json<SuggestionResponse>({ suggestion: svc.unreject(c.req.param("id")) }),
  );

  r.get("/planning/media/:inputId", (c) => media(c.req.raw, s, c.req.param("inputId"), "original"));
  r.get("/planning/media/:inputId/jpeg", (c) => media(c.req.raw, s, c.req.param("inputId"), "jpeg"));

  return r;
}

function media(req: Request, s: Services, inputId: string, variant: "original" | "jpeg"): Response {
  const f = s.planningRequests.mediaFile(inputId, variant);
  return fileResponse(req, { ...f, downloadName: basename(f.path) });
}
