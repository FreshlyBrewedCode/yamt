import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  analysisConfig,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_PUSH_SUBJECT,
  DEFAULT_STT_SETTINGS,
  dataPaths,
  ensureDataDir,
  loadConfig,
  resolveDataDir,
  STT_RUNNER,
} from "../src/config.ts";
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
  test("creates the dir with media/, runs/ and models/, all 0700", () => {
    const dir = join(tempDir(), "data");
    const paths = ensureDataDir(dir);
    for (const p of [dir, paths.media, paths.runs, paths.models]) {
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
  test("no file, no env: no login, no FDC key, Claude Code with the default model", () => {
    expect(loadConfig(tempDir(), {})).toEqual({
      login: null,
      fdcApiKey: null,
      analysis: {
        harness: { kind: "claude-code", command: "", args: [], env: {} },
        model: DEFAULT_ANALYSIS_MODEL,
      },
      transcription: {
        command: [STT_RUNNER, "transcribe"],
        ffmpeg: null,
        modelsDir: null,
        settings: {
          model: "large-v3-turbo",
          computeType: "int8",
          threads: 4,
          beamSize: 1,
          vad: true,
          language: "de",
          initialPrompt: null,
        },
      },
      push: { subject: DEFAULT_PUSH_SUBJECT },
    });
    expect(STT_RUNNER).toEndWith("/services/stt/run.sh");
    expect(existsSync(STT_RUNNER)).toBe(true);
  });

  test("push subject from config.json, env wins; only mailto: or https:", () => {
    const dir = tempDir();
    writeFileSync(dataPaths(dir).config, JSON.stringify({ push: { subject: "mailto:alice@example.com" } }));
    expect(loadConfig(dir, {}).push).toEqual({ subject: "mailto:alice@example.com" });
    expect(loadConfig(dir, { YAMT_PUSH_SUBJECT: "https://example.com/yamt" }).push.subject).toBe(
      "https://example.com/yamt",
    );
    expect(() => loadConfig(dir, { YAMT_PUSH_SUBJECT: "alice@example.com" })).toThrow("YAMT_PUSH_SUBJECT");
    writeFileSync(dataPaths(dir).config, JSON.stringify({ push: { subject: "http://example.com" } }));
    expect(() => loadConfig(dir, {})).toThrow("push.subject");
  });

  test("transcription settings from config.json; env overrides them", () => {
    const dir = tempDir();
    writeFileSync(
      dataPaths(dir).config,
      JSON.stringify({
        transcription: {
          model: "medium",
          threads: 2,
          vad: false,
          initialPrompt: "Haferflocken, Skyr",
          ffmpeg: "/opt/ffmpeg",
          command: "python3",
          args: ["-m", "yamt_stt"],
        },
      }),
    );
    const t = loadConfig(dir, {}).transcription;
    expect(t.command).toEqual(["python3", "-m", "yamt_stt"]);
    expect(t.ffmpeg).toBe("/opt/ffmpeg");
    expect(t.settings).toEqual({
      ...DEFAULT_STT_SETTINGS,
      model: "medium",
      threads: 2,
      vad: false,
      initialPrompt: "Haferflocken, Skyr",
    });
    const e = loadConfig(dir, {
      YAMT_STT_COMMAND: "bun fake-stt.ts",
      YAMT_STT_THREADS: "6",
      YAMT_STT_VAD: "1",
      YAMT_STT_COMPUTE_TYPE: "float32",
      YAMT_STT_MODELS_DIR: "/tmp/models",
      YAMT_FFMPEG: "/usr/bin/ffmpeg",
    }).transcription;
    expect(e.command).toEqual(["bun", "fake-stt.ts"]);
    expect(e.settings).toMatchObject({ threads: 6, vad: true, computeType: "float32", model: "medium" });
    expect([e.modelsDir, e.ffmpeg]).toEqual(["/tmp/models", "/usr/bin/ffmpeg"]);
    expect(() => loadConfig(dir, { YAMT_STT_THREADS: "lots" })).toThrow("YAMT_STT_THREADS");
    expect(() => loadConfig(dir, { YAMT_STT_VAD: "maybe" })).toThrow("YAMT_STT_VAD");
  });

  test("the analysis harness and model from config.json; env overrides them", () => {
    const dir = tempDir();
    writeFileSync(
      dataPaths(dir).config,
      JSON.stringify({
        analysis: { harness: "custom", command: "my-agent", args: ["acp"], env: { A: "1" }, model: "m1" },
      }),
    );
    expect(loadConfig(dir, {}).analysis).toEqual({
      harness: { kind: "custom", command: "my-agent", args: ["acp"], env: { A: "1" } },
      model: "m1",
    });
    expect(
      loadConfig(dir, { YAMT_ANALYSIS_COMMAND: "bun  fake-agent.ts", YAMT_ANALYSIS_MODEL: "m2" }).analysis,
    ).toEqual({
      harness: { kind: "custom", command: "bun", args: ["fake-agent.ts"], env: { A: "1" } },
      model: "m2",
    });
    expect(loadConfig(dir, { YAMT_ANALYSIS_HARNESS: "claude-code" }).analysis.harness.kind).toBe(
      "claude-code",
    );
    expect(() => loadConfig(dir, { YAMT_ANALYSIS_HARNESS: "codex" })).toThrow("YAMT_ANALYSIS_HARNESS");
    expect(() => analysisConfig({ harness: "custom" }, {})).toThrow("needs a command");
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
