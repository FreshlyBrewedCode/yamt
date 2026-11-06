import {
  AddShoppingLineBody,
  ShoppingCheckBody,
  type ShoppingListResponse,
  ShoppingQuery,
} from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/**
 * The shopping list (#49; mounted under /api, behind auth). Paths: `shoppingPaths`. Writes answer
 * the list for their range; `tz` (the phone's zone) comes as a query parameter like the list's.
 */
export function shoppingRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();
  const zone = (tz: string | undefined) => ShoppingQuery.shape.tz.parse(tz);

  r.get("/shopping", (c) =>
    c.json<ShoppingListResponse>(s.shopping.list(ShoppingQuery.parse(c.req.query()))),
  );

  r.post("/shopping/check", async (c) =>
    c.json<ShoppingListResponse>(
      s.shopping.check(ShoppingCheckBody.parse(await readJson(c)), zone(c.req.query("tz"))),
    ),
  );

  r.post("/shopping/lines", async (c) => {
    const { list, created } = s.shopping.addLine(
      AddShoppingLineBody.parse(await readJson(c)),
      zone(c.req.query("tz")),
    );
    return c.json<ShoppingListResponse>(list, created ? 201 : 200);
  });

  r.delete("/shopping/lines/:id", (c) => {
    s.shopping.removeLine(c.req.param("id"));
    return c.body(null, 204);
  });

  return r;
}
