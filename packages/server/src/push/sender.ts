import type { PushDelivery, PushEvent, PushPayload } from "@yamt/shared";
import webpush from "web-push";
import type { PushSubscriptionRecord, PushSubscriptionRepo } from "../db/repos/push.ts";
import type { Fetch } from "../nutrition/http.ts";
import type { VapidKeys } from "./vapid.ts";

export interface PushSenderOptions {
  /** The VAPID key pair (read or made on first use). */
  keys: () => VapidKeys;
  /** The VAPID subject: `mailto:` or `https:`. */
  subject: string;
  /** Outbound HTTP to the push services; a recording fake in tests. */
  fetch: Fetch;
  /** How long a push service keeps an undelivered message (default 12 h). */
  ttlSeconds?: number;
  timeoutMs?: number;
  now?: () => number;
  /** Where delivery problems are reported; never with the payload or the endpoint's path. */
  log?: (message: string) => void;
}

export interface DeliveryOptions {
  /** Replaces an undelivered message with the same topic (≤ 32 URL-safe base64 characters). */
  topic?: string;
  urgency?: "very-low" | "low" | "normal" | "high";
}

export interface DeliveryResult {
  delivery: PushDelivery;
  error: string | null;
}

/**
 * Sends Web Push messages: `web-push` encrypts the payload for the subscription (RFC 8291,
 * aes128gcm) and signs the VAPID JWT (RFC 8292); the request itself goes out through `fetch`.
 * A 404 or 410 from the push service means the subscription is gone: it is deleted. Other
 * failures are recorded on the subscription and logged without anything personal (the push
 * service's host and the status only).
 */
export class PushSender {
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(
    private readonly subscriptions: PushSubscriptionRepo,
    private readonly o: PushSenderOptions,
  ) {
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((m) => console.warn(m));
  }

  /** The VAPID public key, the app's `applicationServerKey`. */
  publicKey(): string {
    return this.o.keys().publicKey;
  }

  /** Sends to every subscription that wants `event`; resolves when each delivery ended. */
  async broadcast(
    event: PushEvent,
    payload: PushPayload,
    opts: DeliveryOptions = {},
  ): Promise<DeliveryResult[]> {
    const targets = this.subscriptions.list().filter((s) => s.events[event]);
    return Promise.all(targets.map((s) => this.deliver(s, payload, opts)));
  }

  /** One message to one subscription. Never throws: the result says how it went. */
  async deliver(
    sub: PushSubscriptionRecord,
    payload: PushPayload,
    opts: DeliveryOptions = {},
  ): Promise<DeliveryResult> {
    const host = hostOf(sub.endpoint);
    let request: webpush.RequestDetails;
    try {
      const keys = this.o.keys();
      request = webpush.generateRequestDetails(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
        {
          vapidDetails: { subject: this.o.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          contentEncoding: "aes128gcm",
          TTL: this.o.ttlSeconds ?? 12 * 60 * 60,
          urgency: opts.urgency ?? "normal",
          topic: opts.topic,
        },
      );
    } catch (e) {
      return this.failed(sub, `can't encrypt for this subscription: ${(e as Error).message}`, host);
    }

    let res: Response;
    try {
      res = await this.o.fetch(request.endpoint, {
        method: request.method,
        // fetch sets Content-Length itself
        headers: Object.fromEntries(
          Object.entries(request.headers)
            .filter(([k]) => k.toLowerCase() !== "content-length")
            .map(([k, v]) => [k, String(v)]),
        ),
        body: request.body ? new Uint8Array(request.body) : null,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch (e) {
      return this.failed(sub, `push service unreachable: ${(e as Error).message}`, host);
    }

    if (res.ok) {
      await res.body?.cancel();
      this.subscriptions.recordDelivery(sub.id, { ok: true, at: this.now() });
      return { delivery: "sent", error: null };
    }
    const detail = (await res.text().catch(() => "")).trim().replace(/\s+/g, " ").slice(0, 200);
    if (res.status === 404 || res.status === 410) {
      this.subscriptions.delete(sub.id);
      this.log(`push: ${host} answered ${res.status}, the subscription is gone and was removed`);
      return { delivery: "gone", error: `the subscription expired (${res.status})` };
    }
    return this.failed(sub, `push service answered ${res.status}${detail ? `: ${detail}` : ""}`, host);
  }

  private failed(sub: PushSubscriptionRecord, error: string, host: string): DeliveryResult {
    this.subscriptions.recordDelivery(sub.id, { ok: false, error });
    this.log(`push: delivery to ${host} failed: ${error}`);
    return { delivery: "failed", error };
  }
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "an invalid endpoint";
  }
}
