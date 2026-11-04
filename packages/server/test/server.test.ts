import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiPaths } from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";

const dataDir = join(tempDir(), "data");
const webDist = tempDir("yamt-dist-");
mkdirSync(join(webDist, "assets"));
writeFileSync(join(webDist, "index.html"), "<!doctype html><title>yamt</title>");
writeFileSync(join(webDist, "assets", "app-abc.js"), "console.log(1)");

const app = createServer({
  dataDir,
  port: 0,
  webDist,
  auth: { kind: "tailnet", login: "alice@example.com" },
});
afterAll(() => app.stop());
const url = (path: string) => new URL(path, app.localUrl).toString();

describe("server", () => {
  test("creates the data dir 0700 with the database", () => {
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, "yamt.db")).mode & 0o777).toBe(0o600);
  });

  test("health answers without auth", async () => {
    const res = await fetch(url(apiPaths.health));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", version: expect.any(String) });
  });

  test("every other API route needs the identity, including unknown ones", async () => {
    expect((await fetch(url(apiPaths.me))).status).toBe(401);
    expect((await fetch(url("/api/nope"))).status).toBe(401);
    const me = await fetch(url(apiPaths.me), { headers: { [IDENTITY_HEADER]: "alice@example.com" } });
    expect(await me.json()).toEqual({ login: "alice@example.com" });
    const nope = await fetch(url("/api/nope"), { headers: { [IDENTITY_HEADER]: "alice@example.com" } });
    expect(nope.status).toBe(404);
  });

  test("serves the SPA: assets cached forever, client routes fall back to index.html", async () => {
    const asset = await fetch(url("/assets/app-abc.js"));
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const route = await fetch(url("/meals/123"));
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("<title>yamt</title>");
  });
});
