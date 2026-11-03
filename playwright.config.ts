import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// One throwaway server per run: temp data dir, localhost only, the dev auth bypass (there is no
// `tailscale serve` in front of it to add the identity header).
process.env.YAMT_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), "yamt-e2e-"));
const port = Number(process.env.YAMT_E2E_PORT ?? 7898);
// Playwright's downloaded browsers don't run on NixOS: use a nix chromium if one is linked
// (`nix build nixpkgs#chromium -o .chromium`) or named in YAMT_E2E_CHROMIUM.
const chromium =
  process.env.YAMT_E2E_CHROMIUM ??
  (existsSync(".chromium/bin/chromium") ? ".chromium/bin/chromium" : undefined);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      // Mobile first: the iPhone is the main client (390×844, touch), in Chromium.
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        launchOptions: chromium ? { executablePath: chromium } : {},
      },
    },
  ],
  webServer: {
    command: `bun packages/server/src/cli.ts start --local --no-auth --no-build --port ${port} --data-dir ${process.env.YAMT_E2E_DATA_DIR}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    stdout: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    // analyses run against the scripted fake agent, never a real Claude
    env: {
      ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
        string,
        string
      >),
      YAMT_ANALYSIS_HARNESS: "custom",
      YAMT_ANALYSIS_COMMAND: `bun ${resolve("packages/server/test/fake-agent.ts")}`,
    },
  },
});
