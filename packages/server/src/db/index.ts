import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Db = Database;

export const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

/**
 * Opens (and migrates) the SQLite database. Pass ":memory:" in tests.
 * The file and its -wal/-shm companions are 0600; WAL, foreign keys and a busy timeout are on.
 */
export function openDb(path: string, migrationsDir = MIGRATIONS_DIR): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  // 0600 before WAL mode creates -wal/-shm (SQLite gives them the DB file's mode); a DB created
  // with a looser mode gets tightened here too
  if (path !== ":memory:") {
    for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
  }
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  migrate(db, migrationsDir);
  return db;
}

/**
 * Applies the `*.sql` files in `dir` that haven't run yet, in file-name order, each in its own
 * transaction. They are tracked by name (not a counter), so parallel branches can each add one
 * without renumbering: name them `<YYYYMMDDHHmm>_<what>.sql`.
 *
 * Applied migrations are never edited: their checksum is stored, and a changed file stops the
 * server instead of silently diverging from databases that ran the old version.
 * Returns the names applied by this call.
 */
export function migrate(db: Db, dir = MIGRATIONS_DIR): string[] {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = new Map(
    db
      .query<{ name: string; checksum: string }, []>("SELECT name, checksum FROM schema_migrations")
      .all()
      .map((r) => [r.name, r.checksum]),
  );
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];
  const pending: { name: string; sql: string; checksum: string }[] = [];
  for (const name of files) {
    const sql = readFileSync(join(dir, name), "utf8");
    const checksum = sha256(sql);
    const known = applied.get(name);
    if (known === undefined) pending.push({ name, sql, checksum });
    else if (known !== checksum) {
      throw new Error(`migration ${name} was edited after it was applied; add a new migration instead`);
    }
  }
  for (const m of pending) {
    try {
      db.transaction(() => {
        db.run(m.sql);
        db.query("INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)").run(
          m.name,
          m.checksum,
          Date.now(),
        );
      })();
    } catch (e) {
      throw new Error(`migration ${m.name} failed: ${(e as Error).message}`);
    }
  }
  return pending.map((m) => m.name);
}

export function appliedMigrations(db: Db): number {
  return db.query<{ n: number }, []>("SELECT count(*) AS n FROM schema_migrations").get()?.n ?? 0;
}

/** Every row id: UUIDv7, so ids sort by creation time. */
export const newId = (): string => Bun.randomUUIDv7();

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
