import type { Db } from "../index.ts";

/**
 * Settings made in the app (#28), one JSON value per key (`agent`). Never secrets: those stay in
 * config.json and the env.
 */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get<T>(key: string): T | null {
    const r = this.db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key);
    return r ? (JSON.parse(r.value) as T) : null;
  }

  set(key: string, value: unknown, now = Date.now()): void {
    this.db
      .query(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now);
  }

  delete(key: string): void {
    this.db.query("DELETE FROM settings WHERE key = ?").run(key);
  }
}
