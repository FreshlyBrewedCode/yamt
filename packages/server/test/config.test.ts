import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataPaths, ensureDataDir, loadConfig, resolveDataDir } from "../src/config.ts";
import { tempDir } from "./helpers.ts";

const mode = (p: string) => statSync(p).mode & 0o777;

describe("resolveDataDir", () => {
  test("defaults to ~/.yamt", () => {
    expect(resolveDataDir(undefined, {})).toBe(join(homedir(), ".yamt"));
  });

  test("YAMT_DATA_DIR overrides the default, the flag overrides both", () => {
    expect(resolveDataDir(undefined, { YAMT_DATA_DIR: "/tmp/env" })).toBe("/tmp/env");
    expect(resolveDataDir("/tmp/flag", { YAMT_DATA_DIR: "/tmp/env" })).toBe("/tmp/flag");
  });

  test("expands ~ and resolves relative paths", () => {
    expect(resolveDataDir("~/x", {})).toBe(join(homedir(), "x"));
    expect(resolveDataDir("rel", {})).toBe(join(process.cwd(), "rel"));
  });
});

describe("ensureDataDir", () => {
  test("creates the dir with media/ and runs/, all 0700", () => {
    const dir = join(tempDir(), "data");
    const paths = ensureDataDir(dir);
    for (const p of [dir, paths.media, paths.runs]) {
      expect(existsSync(p)).toBe(true);
      expect(mode(p)).toBe(0o700);
    }
    expect(paths.db).toBe(join(dir, "yamt.db"));
  });

  test("tightens an existing dir with a looser mode and keeps its contents", () => {
    const dir = tempDir();
    chmodSync(dir, 0o755);
    mkdirSync(join(dir, "media"), { mode: 0o755 });
    writeFileSync(join(dir, "media", "keep.jpg"), "x");
    ensureDataDir(dir);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, "media"))).toBe(0o700);
    expect(existsSync(join(dir, "media", "keep.jpg"))).toBe(true);
  });
});

describe("loadConfig", () => {
  test("no file, no env: no login, no FDC key", () => {
    expect(loadConfig(tempDir(), {})).toEqual({ login: null, fdcApiKey: null });
  });

  test("reads the login from config.json; YAMT_LOGIN overrides it", () => {
    const dir = tempDir();
    writeFileSync(dataPaths(dir).config, JSON.stringify({ login: " alice@example.com " }));
    expect(loadConfig(dir, {}).login).toBe("alice@example.com");
    expect(loadConfig(dir, { YAMT_LOGIN: "bob@example.com" }).login).toBe("bob@example.com");
  });

  test("reads the FDC key from config.json; FDC_API_KEY overrides it", () => {
    const dir = tempDir();
    writeFileSync(dataPaths(dir).config, JSON.stringify({ fdcApiKey: "file-key" }));
    expect(loadConfig(dir, {}).fdcApiKey).toBe("file-key");
    expect(loadConfig(dir, { FDC_API_KEY: "env-key" }).fdcApiKey).toBe("env-key");
  });

  test("rejects unknown keys", () => {
    const dir = tempDir();
    writeFileSync(dataPaths(dir).config, JSON.stringify({ logn: "typo@example.com" }));
    expect(() => loadConfig(dir, {})).toThrow("config.json");
  });
});
