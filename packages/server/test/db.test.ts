import { describe, expect, test } from "bun:test";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appliedMigrations, migrate, newId, openDb } from "../src/db/index.ts";
import { tempDir } from "./helpers.ts";

function migrationsDir(files: Record<string, string>): string {
  const dir = tempDir("yamt-migrations-");
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

const names = (db: ReturnType<typeof openDb>) =>
  db
    .query<{ name: string }, []>("SELECT name FROM schema_migrations ORDER BY name")
    .all()
    .map((r) => r.name);

describe("migrate", () => {
  test("applies *.sql files in name order, once, tracked by name", () => {
    const dir = migrationsDir({
      "202611021200_b.sql": "ALTER TABLE a ADD COLUMN note TEXT;",
      "202611021100_a.sql": "CREATE TABLE a (id TEXT PRIMARY KEY); CREATE INDEX a_id ON a (id);",
      "README.md": "not a migration",
    });
    const db = openDb(":memory:", dir);
    expect(names(db)).toEqual(["202611021100_a.sql", "202611021200_b.sql"]);
    expect(migrate(db, dir)).toEqual([]);
    expect(appliedMigrations(db)).toBe(2);
    db.run("INSERT INTO a (id, note) VALUES ('x', 'y')");
  });

  test("a new file on a later start is applied on its own", () => {
    const dir = migrationsDir({ "202611021100_a.sql": "CREATE TABLE a (id TEXT PRIMARY KEY);" });
    const db = openDb(":memory:", dir);
    writeFileSync(join(dir, "202611021300_c.sql"), "CREATE TABLE c (id TEXT PRIMARY KEY);");
    expect(migrate(db, dir)).toEqual(["202611021300_c.sql"]);
  });

  test("a failing migration rolls back entirely and names the file", () => {
    const dir = migrationsDir({
      "202611021100_a.sql": "CREATE TABLE a (id TEXT PRIMARY KEY);",
      "202611021200_bad.sql": "CREATE TABLE half (id TEXT); INSERT INTO nope VALUES (1);",
    });
    expect(() => openDb(":memory:", dir)).toThrow("migration 202611021200_bad.sql failed");
    const path = join(tempDir(), "yamt.db");
    expect(() => openDb(path, dir)).toThrow();
    const db = openDb(path, migrationsDir({}));
    expect(names(db)).toEqual(["202611021100_a.sql"]);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeNull();
  });

  test("an applied migration that was edited stops the start", () => {
    const dir = migrationsDir({ "202611021100_a.sql": "CREATE TABLE a (id TEXT PRIMARY KEY);" });
    const path = join(tempDir(), "yamt.db");
    openDb(path, dir).close();
    writeFileSync(join(dir, "202611021100_a.sql"), "CREATE TABLE a (id TEXT PRIMARY KEY, x TEXT);");
    expect(() => openDb(path, dir)).toThrow("was edited after it was applied");
  });

  test("the shipped migrations apply to an empty database", () => {
    const db = openDb(":memory:");
    expect(appliedMigrations(db)).toBeGreaterThanOrEqual(0);
  });
});

describe("openDb", () => {
  test("WAL, foreign keys and busy timeout; files are 0600", () => {
    const path = join(tempDir(), "sub", "yamt.db");
    const db = openDb(path, migrationsDir({ "202611021100_a.sql": "CREATE TABLE a (id TEXT);" }));
    db.run("INSERT INTO a VALUES ('x')");
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout).toBe(5000);
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      expect(existsSync(f)).toBe(true);
      expect(statSync(f).mode & 0o777).toBe(0o600);
    }
    db.close();
  });
});

describe("newId", () => {
  test("UUIDv7, sorting by creation", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
