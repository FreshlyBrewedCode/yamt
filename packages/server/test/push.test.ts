import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createDecipheriv, createECDH, createHmac, type ECDH, randomBytes } from "node:crypto";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_PUSH_EVENTS,
  type Meal,
  type MealRevisionView,
  mealPaths,
  type PushPayload,
  type PushResponse,
  type PushSubscriptionResponse,
  type PushTestResponse,
  pushPaths,
  type RepeatMealResponse,
} from "@yamt/shared";
import type { AnalysisConfig } from "../src/config.ts";
import { dataPaths } from "../src/config.ts";
import { openDb } from "../src/db/index.ts";
import { createRepos } from "../src/db/repos/index.ts";
import { mealNotification } from "../src/push/messages.ts";
import { PushSender } from "../src/push/sender.ts";
import { loadVapidKeys } from "../src/push/vapid.ts";
import { createServer } from "../src/server.ts";
import { fakeAgentConfig, tempDir } from "./helpers.ts";

setDefaultTimeout(30_000);

// ---- a fake browser and a fake push service ----------------------------------------------------

/** A browser's side of a subscription: its ECDH key pair and auth secret, as PushManager makes them. */
function browser(endpoint = `https://push.example.com/send/${randomBytes(8).toString("hex")}`) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: {
      endpoint,
      keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    },
  };
}

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/**
 * Decrypts an aes128gcm Web Push body the way the browser does (RFC 8291 / RFC 8188), written
 * from the RFCs rather than with the library that encrypted it.
 */
function decrypt(body: Uint8Array, ecdh: ECDH, auth: Buffer): string {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const idLen = buf[20]!;
  const serverPublic = buf.subarray(21, 21 + idLen);
  const ciphertext = buf.subarray(21 + idLen);
  const shared = ecdh.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), serverPublic]);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // the last record ends with the delimiter 0x02, then zero padding
  return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8");
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Records every request; answers 201 unless `answer` says otherwise for an endpoint. */
function pushService() {
  const sent: Sent[] = [];
  const answers = new Map<string, number | Error>();
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({
      url,
      headers: init?.headers as Record<string, string>,
      body: new Uint8Array(init?.body as Uint8Array),
    });
    const a = answers.get(url) ?? 201;
    if (a instanceof Error) throw a;
    return new Response(a === 201 ? "" : '{"reason":"Unregistered"}', { status: a });
  };
  return { sent, answers, fetch };
}

const payloadOf = (s: Sent, b: ReturnType<typeof browser>) =>
  JSON.parse(decrypt(s.body, b.ecdh, b.auth)) as PushPayload;

const PAYLOAD: PushPayload = {
  title: "Porridge · 420 kcal",
  body: "Protein 12 g",
  url: "/meals/x",
  tag: "meal-x",
  event: "analysed",
};

function setup() {
  const dir = tempDir();
  const db = openDb(join(dir, "yamt.db"));
  const repos = createRepos(db);
  const service = pushService();
  const logs: string[] = [];
  const sender = new PushSender(repos.pushSubscriptions, {
    keys: () => loadVapidKeys(join(dir, "vapid.json")),
    subject: "mailto:alice@example.com",
    fetch: service.fetch,
    log: (m) => logs.push(m),
  });
  return { dir, repos, service, sender, logs };
}

// ---- VAPID ----------------------------------------------------------------------------------------

describe("VAPID keys", () => {
  test("made once, 0600, the same on every load; a broken file is an error, not replaced", () => {
    const path = join(tempDir(), "vapid.json");
    const first = loadVapidKeys(path);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(Buffer.from(first.publicKey, "base64url")[0]).toBe(4); // uncompressed P-256 point
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadVapidKeys(path)).toEqual(first);
    writeFileSync(path, "{}");
    expect(() => loadVapidKeys(path)).toThrow("not a VAPID key pair");
  });
});

// ---- the sender -------------------------------------------------------------------------------------

describe("PushSender", () => {
  test("encrypts the payload for the subscription and signs a VAPID JWT for the push service", async () => {
    const { repos, service, sender, dir } = setup();
    const b = browser();
    const { subscription } = repos.pushSubscriptions.upsert(b.subscription);
    const result = await sender.deliver(subscription, PAYLOAD, { topic: "abc", urgency: "high" });
    expect(result).toEqual({ delivery: "sent", error: null });

    const [req] = service.sent;
    expect(req!.url).toBe(b.subscription.endpoint);
    expect(req!.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(12 * 60 * 60),
      Urgency: "high",
      Topic: "abc",
    });
    expect(payloadOf(req!, b)).toEqual(PAYLOAD);
    // nothing of the payload in the clear
    expect(Buffer.from(req!.body).toString("latin1")).not.toContain("Porridge");

    // Authorization: vapid t=<JWT>, k=<public key>; the JWT verifies with that key
    const keys = loadVapidKeys(join(dir, "vapid.json"));
    const m = req!.headers.Authorization!.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(m?.[2]).toBe(keys.publicKey);
    const [h, p, sig] = m![1]!.split(".");
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ aud: "https://push.example.com", sub: "mailto:alice@example.com" });
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from(keys.publicKey, "base64url"),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(sig!, "base64url"),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
    expect(repos.pushSubscriptions.get(subscription.id)).toMatchObject({ lastError: null });
    expect(repos.pushSubscriptions.get(subscription.id)!.lastSentAt).toBeNumber();
  });

  test("404 and 410 remove the subscription; other failures keep it with the reason; nothing personal is logged", async () => {
    const { repos, service, sender, logs } = setup();
    const gone404 = repos.pushSubscriptions.upsert(browser().subscription).subscription;
    const gone410 = repos.pushSubscriptions.upsert(browser().subscription).subscription;
    const busy = repos.pushSubscriptions.upsert(browser().subscription).subscription;
    const offline = repos.pushSubscriptions.upsert(browser().subscription).subscription;
    service.answers.set(gone404.endpoint, 404);
    service.answers.set(gone410.endpoint, 410);
    service.answers.set(busy.endpoint, 503);
    service.answers.set(offline.endpoint, new Error("getaddrinfo ENOTFOUND"));

    const results = await sender.broadcast("analysed", PAYLOAD);
    expect(results.map((r) => r.delivery)).toEqual(["gone", "gone", "failed", "failed"]);
    expect(repos.pushSubscriptions.list().map((s) => s.id)).toEqual([busy.id, offline.id]);
    expect(repos.pushSubscriptions.get(busy.id)!.lastError).toContain("answered 503");
    expect(repos.pushSubscriptions.get(offline.id)!.lastError).toContain(
      "unreachable: getaddrinfo ENOTFOUND",
    );
    expect(logs).toHaveLength(4);
    for (const line of logs) {
      expect(line).toContain("push.example.com");
      expect(line).not.toContain("/send/");
      expect(line).not.toContain("Porridge");
    }
  });

  test("broadcast respects each subscription's toggles", async () => {
    const { repos, service, sender } = setup();
    const all = browser();
    const quiet = browser();
    repos.pushSubscriptions.upsert(all.subscription);
    repos.pushSubscriptions.upsert({
      ...quiet.subscription,
      events: { ...ALL_PUSH_EVENTS, analysed: false },
    });
    await sender.broadcast("analysed", PAYLOAD);
    expect(service.sent.map((s) => s.url)).toEqual([all.subscription.endpoint]);
    await sender.broadcast("failed", { ...PAYLOAD, event: "failed" });
    expect(
      service.sent
        .map((s) => s.url)
        .slice(1)
        .sort(),
    ).toEqual([all.subscription.endpoint, quiet.subscription.endpoint].sort());
  });
});

// ---- what a meal's notification says ---------------------------------------------------------------

describe("mealNotification", () => {
  const meal = (over: Partial<Meal>): Meal => ({
    id: "0190a0b0-0000-7000-8000-000000000001",
    status: "analysed",
    eatenAt: Date.UTC(2026, 10, 3, 12, 5),
    eatenAtSource: "capture",
    currentRevisionId: "r1",
    analysisError: null,
    sourceMealId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });
  const view = (title: string, kcal: number, questions: string[] = []) =>
    ({
      revision: { title },
      totals: { nutrients: { energyKcal: kcal, protein: 24.4, fat: 8.04, carbohydrate: 61 } },
      questions: questions.map((question) => ({ question })),
    }) as unknown as MealRevisionView;

  test("analysed: the title and kcal, the macros; a tap opens the meal", () => {
    expect(mealNotification(meal({}), view("Porridge mit Blaubeeren", 1432), "Europe/Berlin")).toEqual({
      event: "analysed",
      payload: {
        title: "Porridge mit Blaubeeren · 1,432 kcal",
        body: "Protein 24 g · Fat 8 g · Carbs 61 g",
        url: "/meals/0190a0b0-0000-7000-8000-000000000001",
        tag: "meal-0190a0b0-0000-7000-8000-000000000001",
        event: "analysed",
      },
    });
  });

  test("needs input: the first question, and how many more; the link goes to the questions", () => {
    const n = mealNotification(
      meal({ status: "needs_input" }),
      view("Bratkartoffeln", 650, ["Wie viel Öl war in der Pfanne?", "Mit Speck?"]),
      "Europe/Berlin",
    );
    expect(n?.payload).toMatchObject({
      title: "Bratkartoffeln · needs input",
      body: "Wie viel Öl war in der Pfanne? (+1 more)",
      url: "/meals/0190a0b0-0000-7000-8000-000000000001#questions",
    });
  });

  test("failed: 'Meal at HH:MM' without a revision, the error's first part", () => {
    const n = mealNotification(
      meal({
        status: "failed",
        currentRevisionId: null,
        analysisError: 'the agent ended its turn (end_turn) without calling save_meal_revision; it said: "…"',
      }),
      null,
      "Europe/Berlin",
    );
    expect(n?.payload).toMatchObject({
      title: "Meal at 13:05 · failed",
      body: "The agent ended its turn (end_turn) without calling save_meal_revision. Tap to retry.",
    });
  });

  test("no notification for any other status", () => {
    for (const status of ["draft", "queued", "analysing"] as const) {
      expect(mealNotification(meal({ status }), view("x", 1), "UTC")).toBeNull();
    }
  });
});

// ---- the API and the analysis job ------------------------------------------------------------------

const fakeHarness: AnalysisConfig = fakeAgentConfig();
const service = pushService();
const app = createServer({
  dataDir: join(tempDir(), "data"),
  port: 0,
  webDist: null,
  auth: { kind: "off" },
  worker: { pollMs: 20 },
  analysis: {
    config: fakeHarness,
    timeouts: { idleMs: 3000, toolIdleMs: 3000, turnMs: 15_000, cancelGraceMs: 300 },
    transcriptWaitMs: 50,
  },
  push: { fetch: service.fetch, log: () => {} },
});
const s = app.services;
afterAll(() => app.stop());

const origin = new URL(app.localUrl).origin;
const call = async <T>(method: string, path: string, body?: unknown) => {
  const res = await fetch(new URL(path, app.localUrl), {
    method,
    headers: { Origin: origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (res.status === 204 ? null : await res.json()) as T };
};

async function waitFor<T>(
  what: string,
  fn: () => T | null | undefined | false,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

describe("push API", () => {
  test("the key, register (idempotent per endpoint), toggles, test notification, remove", async () => {
    const { body: info } = await call<PushResponse>("GET", pushPaths.push);
    expect(info.publicKey).toBe(loadVapidKeys(dataPaths(s.dataDir).vapid).publicKey);
    expect(statSync(dataPaths(s.dataDir).vapid).mode & 0o777).toBe(0o600);

    const b = browser();
    const created = await call<PushSubscriptionResponse>("POST", pushPaths.subscriptions, {
      ...b.subscription,
      expirationTime: null,
    });
    expect(created.status).toBe(201);
    expect(created.body.subscription).toMatchObject({
      endpoint: b.subscription.endpoint,
      events: ALL_PUSH_EVENTS,
    });
    expect(JSON.stringify(created.body)).not.toContain(b.subscription.keys.auth); // keys stay on the server
    const id = created.body.subscription.id;

    const toggled = await call<PushSubscriptionResponse>("PATCH", pushPaths.subscription(id), {
      ...ALL_PUSH_EVENTS,
      failed: false,
    });
    expect(toggled.body.subscription.events.failed).toBe(false);
    // registering again (the app does at every start) keeps the toggles
    const again = await call<PushSubscriptionResponse>("POST", pushPaths.subscriptions, b.subscription);
    expect(again.status).toBe(200);
    expect(again.body.subscription).toMatchObject({ id, events: { failed: false } });

    const sentBefore = service.sent.length;
    const tested = await call<PushTestResponse>("POST", pushPaths.test(id));
    expect(tested.body).toEqual({ delivery: "sent", error: null });
    expect(payloadOf(service.sent[sentBefore]!, b)).toMatchObject({ event: "test", url: "/settings" });

    expect((await call("DELETE", pushPaths.subscription(id))).status).toBe(204);
    expect((await call("DELETE", pushPaths.subscription(id))).status).toBe(404);
    expect((await call("POST", pushPaths.test(id))).status).toBe(404);
  });

  test("refuses endpoints that aren't https on a public host, and broken keys", async () => {
    const { subscription } = browser();
    for (const endpoint of ["http://push.example.com/x", "https://localhost/x", "https://192.168.1.2/x"]) {
      expect((await call("POST", pushPaths.subscriptions, { ...subscription, endpoint })).status).toBe(400);
    }
    const shortKey = { ...subscription, keys: { ...subscription.keys, auth: "AAAA" } };
    expect((await call("POST", pushPaths.subscriptions, shortKey)).status).toBe(400);
  });
});

describe("notifications from the analysis job", () => {
  const meal = (text: string) => {
    const m = s.meals.create({});
    s.meals.addJson(m.id, { kind: "text", text });
    return m.id;
  };
  /** The messages sent to this browser, decrypted. */
  const received = (b: ReturnType<typeof browser>) =>
    service.sent.filter((x) => x.url === b.subscription.endpoint).map((x) => payloadOf(x, b));

  test("analysed, needs input and failed each notify once, as the toggles allow", async () => {
    const phone = browser();
    const quiet = browser(); // wants failures only
    s.repos.pushSubscriptions.upsert(phone.subscription);
    s.repos.pushSubscriptions.upsert({
      ...quiet.subscription,
      events: { analysed: false, needs_input: false, failed: true },
    });

    const analysed = meal("Porridge, fake:save");
    s.meals.analyse(analysed);
    const [first] = await waitFor("a notification", () => received(phone).length === 1 && received(phone));
    const view = s.revisions.current(s.repos.meals.get(analysed)!)!;
    expect(first).toEqual({
      title: `Testessen · ${view.totals.nutrients.energyKcal} kcal`,
      body: expect.stringMatching(/^Protein \d+ g · Fat \d+ g · Carbs \d+ g$/),
      url: `/meals/${analysed}`,
      tag: `meal-${analysed}`,
      event: "analysed",
    });

    const question = meal("Bratkartoffeln, fake:question");
    s.meals.analyse(question);
    const second = await waitFor("needs input", () => received(phone)[1]);
    expect(second).toMatchObject({ event: "needs_input", url: `/meals/${question}#questions` });
    expect(second.body.length).toBeGreaterThan(0);

    const failing = meal("fake:auth"); // not retried: fails for good at once
    s.meals.analyse(failing);
    const third = await waitFor("failed", () => received(phone)[2]);
    expect(third).toMatchObject({ event: "failed", url: `/meals/${failing}` });
    expect(third.title).toMatch(/^Meal at \d\d:\d\d · failed$/);
    expect(received(quiet).map((p) => p.event)).toEqual(["failed"]);

    // the topic lets a newer message about the meal replace an undelivered one
    const sent = service.sent.find((x) => x.url === phone.subscription.endpoint)!;
    expect(sent.headers.Topic).toBe(analysed.replaceAll("-", ""));
    s.repos.pushSubscriptions.delete(s.repos.pushSubscriptions.byEndpoint(phone.subscription.endpoint)!.id);
    s.repos.pushSubscriptions.delete(s.repos.pushSubscriptions.byEndpoint(quiet.subscription.endpoint)!.id);
  });

  test("no notification while another analysis of the meal is queued; then one for the final state", async () => {
    const phone = browser();
    s.repos.pushSubscriptions.upsert(phone.subscription);
    const mealId = meal("Linsensuppe, fake:slow:600");
    s.meals.analyse(mealId);
    await waitFor("analysing", () => s.repos.meals.get(mealId)!.status === "analysing");
    // a capture arrives during the run and the meal is analysed again
    s.meals.addJson(mealId, { kind: "text", text: "Mit Brot" });
    s.meals.analyse(mealId);

    // the first run saves its revision, but the meal stays queued for the second: no message
    await waitFor("first revision", () => s.repos.revisions.listForMeal(mealId).length === 1);
    await Bun.sleep(150);
    expect(received(phone)).toEqual([]);

    await waitFor("second revision", () => s.repos.revisions.listForMeal(mealId).length === 2);
    await waitFor("one notification", () => received(phone).length === 1);
    await Bun.sleep(150);
    expect(received(phone).map((p) => [p.event, p.url])).toEqual([["analysed", `/meals/${mealId}`]]);
    s.repos.pushSubscriptions.delete(s.repos.pushSubscriptions.byEndpoint(phone.subscription.endpoint)!.id);
  });

  test("logging a meal again notifies nothing: there was no analysis (#30)", async () => {
    const phone = browser();
    s.repos.pushSubscriptions.upsert(phone.subscription);
    const source = meal("Cappuccino, fake:save");
    s.meals.analyse(source);
    await waitFor("analysed", () => received(phone).length === 1);
    const res = await call<RepeatMealResponse>("POST", mealPaths.repeat(source), {
      factor: 1,
      eatenAt: Date.now(),
    });
    expect(res.status).toBe(201);
    expect(res.body.meal.status).toBe("analysed");
    await Bun.sleep(200);
    expect(received(phone).map((p) => p.url)).toEqual([`/meals/${source}`]);
  });
});
