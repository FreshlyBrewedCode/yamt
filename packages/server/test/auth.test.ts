import { describe, expect, test } from "bun:test";
import type { ApiError } from "@yamt/shared";
import { Hono } from "hono";
import { type BearerEnv, requireBearer } from "../src/auth/bearer.ts";
import {
  type AuthMode,
  IDENTITY_HEADER,
  type IdentityEnv,
  requireTailnetIdentity,
} from "../src/auth/identity.ts";
import { handleError, sameOrigin } from "../src/http/middleware.ts";

function identityApp(mode: AuthMode) {
  const app = new Hono<IdentityEnv>();
  app.onError(handleError);
  app.use("*", requireTailnetIdentity(mode));
  app.get("/who", (c) => c.text(c.get("login")));
  return app;
}

type Requester = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
const get = (app: Requester, headers: Record<string, string> = {}) =>
  app.request("http://localhost/who", { headers });
const errorOf = async (res: Response) => (await res.json()) as ApiError;

describe("requireTailnetIdentity", () => {
  const app = identityApp({ kind: "tailnet", login: "alice@example.com" });

  test("accepts the configured login, case-insensitively", async () => {
    const res = await get(app, { [IDENTITY_HEADER]: "Alice@Example.com" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Alice@Example.com");
  });

  test("401 without the header (not through tailscale serve, or a tagged device)", async () => {
    const res = await get(app);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).error).toContain("no Tailscale identity");
  });

  test("401 for another login", async () => {
    const res = await get(app, { [IDENTITY_HEADER]: "mallory@example.com" });
    expect(res.status).toBe(401);
  });

  test("401 for everyone when no login is configured, with a hint", async () => {
    const none = identityApp({ kind: "tailnet", login: null });
    const res = await get(none, { [IDENTITY_HEADER]: "alice@example.com" });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).hint).toContain("YAMT_LOGIN");
  });

  test("the explicit dev bypass lets everything in as `local`", async () => {
    const off = identityApp({ kind: "off" });
    const res = await get(off);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("local");
  });
});

describe("requireBearer", () => {
  const app = new Hono<BearerEnv<{ runId: string }>>();
  app.onError(handleError);
  app.use(
    "*",
    requireBearer((token) => (token === "s3cret" ? { runId: "r1" } : null)),
  );
  app.get("/who", (c) => c.text(c.get("principal").runId));

  test("accepts a token the verifier knows", async () => {
    const res = await get(app, { Authorization: "Bearer s3cret" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("r1");
  });

  test("401 with WWW-Authenticate for a missing, malformed or unknown token", async () => {
    for (const auth of [undefined, "Basic s3cret", "Bearer", "Bearer nope"]) {
      const res = await get(app, auth ? { Authorization: auth } : {});
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    }
  });

  test("the identity header alone is not enough", async () => {
    const res = await get(app, { [IDENTITY_HEADER]: "alice@example.com" });
    expect(res.status).toBe(401);
  });
});

describe("sameOrigin", () => {
  const app = new Hono();
  app.onError(handleError);
  app.use("*", sameOrigin);
  app.all("/x", (c) => c.text("ok"));
  app.all("/api/share", (c) => c.text("ok"));
  app.all("/api/share/x", (c) => c.text("ok"));
  const req = (method: string, headers: Record<string, string>, path = "/x") =>
    app.request(`http://127.0.0.1:7890${path}`, { method, headers });

  test("reads are always allowed", async () => {
    expect((await req("GET", { origin: "https://evil.example" })).status).toBe(200);
    expect((await req("GET", {})).status).toBe(200);
  });

  test("writes need our own origin, also behind tailscale serve's forwarded host", async () => {
    expect((await req("POST", { host: "127.0.0.1:7890", origin: "http://127.0.0.1:7890" })).status).toBe(200);
    expect(
      (await req("POST", { host: "yamt.example.ts.net:7444", origin: "https://yamt.example.ts.net:7444" }))
        .status,
    ).toBe(200);
    expect(
      (
        await req("POST", {
          "x-forwarded-host": "yamt.example.ts.net:7444",
          origin: "https://yamt.example.ts.net:7444",
        })
      ).status,
    ).toBe(200);
    expect(
      (await req("POST", { host: "yamt.example.ts.net:7444", origin: "https://evil.example" })).status,
    ).toBe(403);
  });

  test("a write without an Origin, or with `null`, is refused", async () => {
    expect((await req("POST", {})).status).toBe(403);
    expect((await req("PATCH", {})).status).toBe(403);
    expect((await req("DELETE", { host: "yamt.example.ts.net:7444" })).status).toBe(403);
    expect((await req("POST", { origin: "null" })).status).toBe(403);
  });

  test("POST /api/share alone may come without an Origin (the iOS Shortcut); a foreign one is still refused", async () => {
    const tailnet = { host: "yamt.example.ts.net:7444" };
    expect((await req("POST", tailnet, "/api/share")).status).toBe(200);
    expect(
      (await req("POST", { ...tailnet, origin: "https://yamt.example.ts.net:7444" }, "/api/share")).status,
    ).toBe(200);
    expect((await req("POST", { ...tailnet, origin: "https://evil.example" }, "/api/share")).status).toBe(
      403,
    );
    expect((await req("POST", { ...tailnet, origin: "null" }, "/api/share")).status).toBe(403);
    // only that method and that exact path
    expect((await req("PUT", tailnet, "/api/share")).status).toBe(403);
    expect((await req("POST", tailnet, "/api/share/x")).status).toBe(403);
  });
});
