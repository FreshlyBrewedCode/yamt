import {
  PushEventsBody,
  type PushResponse,
  type PushSubscriptionResponse,
  type PushTestResponse,
  SubscribeBody,
} from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { toView } from "../db/repos/push.ts";
import { HttpError } from "../domain/errors.ts";
import { assertPublicUrl } from "../nutrition/recipe.ts";
import { TEST_NOTIFICATION } from "../push/messages.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** Web Push subscriptions (mounted under /api, behind auth). Paths: `pushPaths`. */
export function pushRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.get("/push", (c) =>
    c.json<PushResponse>({
      publicKey: s.push.publicKey(),
      subscriptions: s.repos.pushSubscriptions.list().map(toView),
    }),
  );

  r.post("/push/subscriptions", async (c) => {
    const body = SubscribeBody.parse(await readJson(c));
    try {
      // the server posts to this URL: a push service on the internet, never this network
      assertPublicUrl(new URL(body.endpoint));
    } catch (e) {
      throw new HttpError(400, `not a push service: ${(e as Error).message}`);
    }
    const { subscription, created } = s.repos.pushSubscriptions.upsert(body);
    return c.json<PushSubscriptionResponse>({ subscription: toView(subscription) }, created ? 201 : 200);
  });

  r.patch("/push/subscriptions/:id", async (c) => {
    const events = PushEventsBody.parse(await readJson(c));
    const subscription = s.repos.pushSubscriptions.setEvents(c.req.param("id"), events);
    if (!subscription) throw new HttpError(404, "subscription not found");
    return c.json<PushSubscriptionResponse>({ subscription: toView(subscription) });
  });

  r.delete("/push/subscriptions/:id", (c) => {
    if (!s.repos.pushSubscriptions.delete(c.req.param("id")))
      throw new HttpError(404, "subscription not found");
    return c.body(null, 204);
  });

  r.post("/push/subscriptions/:id/test", async (c) => {
    const subscription = s.repos.pushSubscriptions.get(c.req.param("id"));
    if (!subscription) throw new HttpError(404, "subscription not found");
    const result = await s.push.deliver(subscription, TEST_NOTIFICATION, { urgency: "high" });
    return c.json<PushTestResponse>(result);
  });

  return r;
}
