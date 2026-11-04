import { ALL_PUSH_EVENTS, PUSH_EVENTS, type PushEvents, type PushSubscriptionView } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  events: string;
  created_at: number;
  updated_at: number;
  last_sent_at: number | null;
  last_error: string | null;
}

/** A subscription with the keys the sender encrypts with (server-only: the API never returns them). */
export interface PushSubscriptionRecord extends PushSubscriptionView {
  keys: { p256dh: string; auth: string };
}

/** Unknown or missing toggles count as on, so a new event type reaches existing subscriptions. */
function parseEvents(json: string): PushEvents {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    // keep the defaults
  }
  return Object.fromEntries(PUSH_EVENTS.map((e) => [e, raw[e] !== false])) as PushEvents;
}

const toRecord = (r: Row): PushSubscriptionRecord => ({
  id: r.id,
  endpoint: r.endpoint,
  keys: { p256dh: r.p256dh, auth: r.auth },
  events: parseEvents(r.events),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastSentAt: r.last_sent_at,
  lastError: r.last_error,
});

/** The view the API returns: without the keys. */
export const toView = ({ keys: _, ...view }: PushSubscriptionRecord): PushSubscriptionView => view;

/** Web Push subscriptions (#13), one per device and browser, keyed by endpoint. */
export class PushSubscriptionRepo {
  constructor(private readonly db: Db) {}

  /**
   * Registers a subscription, or refreshes the one with this endpoint (new keys; the toggles stay
   * unless `events` is given). `created` tells which.
   */
  upsert(s: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    events?: PushEvents;
    now?: number;
  }): { subscription: PushSubscriptionRecord; created: boolean } {
    const now = s.now ?? Date.now();
    const existing = this.byEndpoint(s.endpoint);
    if (existing) {
      this.db
        .query("UPDATE push_subscriptions SET p256dh = ?, auth = ?, events = ?, updated_at = ? WHERE id = ?")
        .run(s.keys.p256dh, s.keys.auth, JSON.stringify(s.events ?? existing.events), now, existing.id);
      return { subscription: this.get(existing.id)!, created: false };
    }
    const id = newId();
    this.db
      .query(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, events, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, s.endpoint, s.keys.p256dh, s.keys.auth, JSON.stringify(s.events ?? ALL_PUSH_EVENTS), now, now);
    return { subscription: this.get(id)!, created: true };
  }

  get(id: string): PushSubscriptionRecord | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM push_subscriptions WHERE id = ?").get(id);
    return r ? toRecord(r) : null;
  }

  byEndpoint(endpoint: string): PushSubscriptionRecord | null {
    const r = this.db
      .query<Row, [string]>("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .get(endpoint);
    return r ? toRecord(r) : null;
  }

  /** Every subscription, oldest first. */
  list(): PushSubscriptionRecord[] {
    return this.db.query<Row, []>("SELECT * FROM push_subscriptions ORDER BY id").all().map(toRecord);
  }

  setEvents(id: string, events: PushEvents, now = Date.now()): PushSubscriptionRecord | null {
    this.db
      .query("UPDATE push_subscriptions SET events = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(events), now, id);
    return this.get(id);
  }

  /** Records a delivery: a success clears the last error, a failure keeps the last success. */
  recordDelivery(id: string, result: { ok: true; at: number } | { ok: false; error: string }): void {
    if (result.ok) {
      this.db
        .query("UPDATE push_subscriptions SET last_sent_at = ?, last_error = NULL WHERE id = ?")
        .run(result.at, id);
    } else {
      this.db.query("UPDATE push_subscriptions SET last_error = ? WHERE id = ?").run(result.error, id);
    }
  }

  delete(id: string): boolean {
    return this.db.query("DELETE FROM push_subscriptions WHERE id = ?").run(id).changes > 0;
  }
}
