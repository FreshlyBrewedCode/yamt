import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ApiError,
  type MealDetailResponse,
  mealPaths,
  SHARE_DRAFT_WINDOW_MS,
  type ShareResponse,
  sharePaths,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { HttpError } from "../src/domain/errors.ts";
import { ShareService } from "../src/domain/share.ts";
import { createServer } from "../src/server.ts";
import { fixture, tempDir } from "./helpers.ts";

// The share target (#26): what the iOS Shortcut posts. Like the Shortcut, these requests carry
// the identity (tailscale serve adds it) and no Origin.
const app = createServer({
  dataDir: join(tempDir(), "data"),
  port: 0,
  webDist: null,
  auth: { kind: "tailnet", login: "alice@example.com" },
  timeZone: "Europe/Berlin",
});
afterAll(() => app.stop());
const s = app.services;

const AUTH = { [IDENTITY_HEADER]: "alice@example.com" };
const JSON_ACCEPT = { accept: "application/json" };

/** Made-up bytes with the header of an `.m4a` (ISO-BMFF ftyp, brand M4A), as Voice Memos shares. */
const fakeM4a = () =>
  new Blob([new TextEncoder().encode("\0\0\0\x14ftypM4A \0\0\0\0M4A "), new Uint8Array(300)]);

type Part = [name: string, value: string | Blob, fileName?: string];
const form = (...parts: Part[]) => {
  const f = new FormData();
  for (const [name, value, fileName] of parts) {
    if (typeof value === "string") f.append(name, value);
    else f.append(name, value, fileName);
  }
  return f;
};

async function share(body: FormData, headers: Record<string, string> = JSON_ACCEPT) {
  const res = await fetch(new URL(sharePaths.share, app.localUrl), {
    method: "POST",
    headers: { ...AUTH, ...headers },
    body,
  });
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("application/json");
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    text,
    body: (json ? JSON.parse(text) : null) as ShareResponse,
  };
}

/** Every draft is older than the window from here on, so each test starts without a current draft. */
const noCurrentDraft = () => {
  s.repos.db.query("UPDATE meals SET updated_at = updated_at - ?").run(SHARE_DRAFT_WINDOW_MS * 2);
};

describe("POST /api/share", () => {
  test("no current draft: a new one at the items' time; the next share joins it", async () => {
    noCurrentDraft();
    const photo = await share(
      form(["file", new Blob([fixture("gradient.jpg")], { type: "image/jpeg" }), "IMG_1.jpg"]),
    );
    expect(photo.status).toBe(201);
    expect(photo.body.newMeal).toBe(true);
    expect(photo.body.captures.map((c) => c.kind)).toEqual(["image"]);
    // EXIF 2026-10-30 12:34:56+01:00: the new draft follows its captures, it isn't pinned
    expect(photo.body.meal).toMatchObject({
      status: "draft",
      eatenAt: Date.parse("2026-10-30T12:34:56+01:00"),
      eatenAtSource: "capture",
    });
    expect(photo.body.summary).toBe("Added 1 photo to a new meal, 12:34");
    expect(photo.body.url).toBe(new URL(`/meals/${photo.body.meal.id}`, app.localUrl).toString());

    // a voice memo, a note and a link in one go: the same meal, the memo gets its transcription
    const more = await share(
      form(
        ["file", fakeM4a(), "New Recording.m4a"],
        ["text", "Dazu ein Glas Apfelschorle"],
        ["url", "https://example.com/rezept/kuerbis-curry"],
      ),
    );
    expect(more.status).toBe(200);
    expect(more.body.newMeal).toBe(false);
    expect(more.body.meal.id).toBe(photo.body.meal.id);
    expect(more.body.captures.map((c) => c.kind)).toEqual(["audio", "text", "link"]);
    expect(more.body.summary).toBe("Added 1 voice memo, 1 note and 1 link to Untitled meal, 12:34");

    const detail = s.meals.detail(photo.body.meal.id) as MealDetailResponse;
    expect(detail.captures.map((c) => c.kind)).toEqual(["image", "audio", "text", "link"]);
    expect(detail.captures[3]?.url).toBe("https://example.com/rezept/kuerbis-curry");
    const memo = detail.captures[1]!;
    expect(memo.mimeType).toBe("audio/mp4");
    expect(detail.transcripts.find((t) => t.captureId === memo.id)?.status).toBe("pending");
    expect(s.repos.jobs.list().some((j) => j.dedupeKey === `transcribe:${memo.id}`)).toBe(true);
    // nothing is analysed by a share
    expect(s.repos.jobs.list().some((j) => j.dedupeKey === `analyse:${photo.body.meal.id}`)).toBe(false);
  });

  test("several files at once, and a capturedAt", async () => {
    noCurrentDraft();
    const at = Date.now() - 20 * 60_000;
    const res = await share(
      form(
        ["file", new Blob([fixture("gradient.jpg")]), "a.jpg"],
        ["file", new Blob([fixture("gradient.heic")]), "b.heic"],
        ["file", fakeM4a(), "memo.m4a"],
        ["capturedAt", new Date(at).toISOString()],
      ),
    );
    expect(res.status).toBe(201);
    expect(res.body.captures.map((c) => [c.kind, c.mimeType, c.capturedAt])).toEqual([
      ["image", "image/jpeg", at],
      ["image", "image/heic", at],
      ["audio", "audio/mp4", at],
    ]);
    expect(res.body.summary).toStartWith("Added 2 photos and 1 voice memo to a new meal, ");
    // epoch milliseconds work too
    const ms = await share(form(["text", "Nachtisch"], ["capturedAt", String(at)]));
    expect(ms.body.captures[0]?.capturedAt).toBe(at);
  });

  test("text the Shortcut sends as a file (a link, a note, a web page, a .webloc) becomes a link or a note", async () => {
    noCurrentDraft();
    const html = `<!doctype html><html><head><meta property="og:url" content="https://example.com/rezept?a=1&amp;b=2"></head></html>`;
    const webloc = `<?xml version="1.0"?><plist version="1.0"><dict><key>URL</key><string>https://example.com/w</string></dict></plist>`;
    const res = await share(
      form(
        ["file", new Blob(["https://example.com/eins\n"], { type: "text/plain" }), "link.txt"],
        ["file", new Blob(["200 g Spaghetti mit Tomatensoße"], { type: "text/plain" }), "note.txt"],
        ["file", new Blob([html], { type: "text/html" }), "page.html"],
        ["file", new Blob([webloc]), "Rezept.webloc"],
        ["file", "https://example.com/als-text"],
        ["file", new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])]), "menu.pdf"],
      ),
    );
    expect(res.status).toBe(201);
    expect(res.body.captures.map((c) => [c.kind, c.url ?? c.text ?? c.mimeType])).toEqual([
      ["link", "https://example.com/eins"],
      ["text", "200 g Spaghetti mit Tomatensoße"],
      ["link", "https://example.com/rezept?a=1&b=2"],
      ["link", "https://example.com/w"],
      ["link", "https://example.com/als-text"],
      ["file", "application/pdf"],
    ]);
  });

  test("answers the summary as plain text unless JSON is asked for, refusals too", async () => {
    noCurrentDraft();
    const ok = await share(form(["text", "Ein Apfel"]), {});
    expect(ok.status).toBe(201);
    expect(ok.type).toStartWith("text/plain");
    expect(ok.text).toMatch(/^Added 1 note to a new meal, \d\d:\d\d$/);

    const none = await share(form(["text", "   "]), {});
    expect(none.status).toBe(400);
    expect(none.text).toBe("Not added: nothing to add (send one or more file, text or url fields)");
    const badUrl = await share(form(["url", "javascript:alert(1)"]), {});
    expect(badUrl.status).toBe(400);
    expect(badUrl.text).toStartWith("Not added: ");
    const notForm = await fetch(new URL(sharePaths.share, app.localUrl), {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "{}",
    });
    expect(notForm.status).toBe(415);
    expect(await notForm.text()).toStartWith("Not added: send multipart/form-data");

    const json = await share(form(["text", "   "]));
    expect(json.status).toBe(400);
    expect((JSON.parse(json.text) as ApiError).error).toBe("nothing to add");
  });

  test("a refused share changes nothing: empty file, a capturedAt in the future", async () => {
    noCurrentDraft();
    const before = s.repos.db.query<{ n: number }, []>("SELECT count(*) AS n FROM meals").get()!.n;
    const empty = await share(form(["text", "Brot"], ["file", new Blob([]), "empty.jpg"]));
    expect(empty.status).toBe(400);
    const future = await share(form(["text", "Brot"], ["capturedAt", String(Date.now() + 2 * 3_600_000)]));
    expect(future.status).toBe(400);
    const garbled = await share(form(["text", "Brot"], ["capturedAt", "gestern"]));
    expect(garbled.status).toBe(400);
    expect(s.repos.db.query<{ n: number }, []>("SELECT count(*) AS n FROM meals").get()!.n).toBe(before);
  });

  test("the meal's URL is on the origin the Shortcut used (tailscale serve's host, https)", async () => {
    const res = await share(form(["text", "Kaffee"]), {
      ...JSON_ACCEPT,
      "x-forwarded-host": "yamt.example.ts.net:7444",
    });
    expect(res.body.url).toBe(`https://yamt.example.ts.net:7444/meals/${res.body.meal.id}`);
  });

  test("auth: the identity is required; no Origin is fine here, a foreign one is not, and other writes still need ours", async () => {
    const anonymous = await fetch(new URL(sharePaths.share, app.localUrl), {
      method: "POST",
      body: form(["text", "Kaffee"]),
    });
    expect(anonymous.status).toBe(401);
    const foreign = await share(form(["text", "Kaffee"]), { ...JSON_ACCEPT, origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    const own = await share(form(["text", "Kaffee"]), {
      ...JSON_ACCEPT,
      origin: new URL(app.localUrl).origin,
    });
    expect(own.status).toBeLessThan(300);
    // the exemption is this route's alone
    const elsewhere = await fetch(new URL(mealPaths.meals, app.localUrl), {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "{}",
    });
    expect(elsewhere.status).toBe(403);
  });
});

describe("the current draft (ShareService)", () => {
  // a time of its own, far from the HTTP tests' meals
  const T = Date.UTC(2031, 4, 4, 17, 0);
  const add = (text: string, now = T) => s.share.share({ files: [], texts: [text], urls: [] }, now);

  test("the most recently updated draft changed within 3 hours; else a new draft", async () => {
    const older = s.repos.meals.insert({ now: T - 2 * 3_600_000 });
    const recent = s.repos.meals.insert({ now: T - 2.9 * 3_600_000 });
    s.meals.addJson(recent.id, { kind: "text", text: "Brot" }, T - 2 * 3_600_000 + 60_000); // changed later
    const analysed = s.repos.meals.insert({ now: T - 60_000 });
    s.repos.meals.setStatus(analysed.id, "analysed", T - 60_000); // not a draft: never shared into

    const first = await add("Butter");
    expect(first.newMeal).toBe(false);
    expect(first.meal.id).toBe(recent.id);
    expect(older.id).not.toBe(first.meal.id);

    // 3 h after its last change it is no longer current: a new draft
    const later = T + SHARE_DRAFT_WINDOW_MS + 1;
    const second = await add("Kaffee", later);
    expect(second.newMeal).toBe(true);
    expect(second.meal).toMatchObject({ status: "draft", createdAt: later, eatenAt: later });
    // exactly at the edge it still counts
    const third = await add("Keks", later + SHARE_DRAFT_WINDOW_MS);
    expect(third.meal.id).toBe(second.meal.id);
  });

  test("files over the upload limit are refused before anything is stored", async () => {
    const small = new ShareService(s.repos, s.meals, "Europe/Berlin", 1000);
    const at = T + 30 * SHARE_DRAFT_WINDOW_MS;
    const big = new File([new Uint8Array(1001).fill(1)], "big.jpg");
    const err = await small.share({ files: [big], texts: ["Brot"], urls: [] }, at).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
    expect(s.repos.meals.latestDraftSince(at - SHARE_DRAFT_WINDOW_MS)).toBeNull();
  });
});
