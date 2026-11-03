#!/usr/bin/env bun
// Renders the PWA icons into public/icons/ with Chromium (Playwright's, or the nix one linked as
// .chromium): a lime square with a black "y" in Space Grotesk, design D (docs/design/design.md).
// Run from the repo root after changing the mark: `bun packages/web/scripts/icons.ts`.
// Also prints the hex values of the page colours for the manifest and theme-color metas.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const web = resolve(import.meta.dir, "..");
const out = join(web, "public/icons");
const font = readFileSync(
  require.resolve("@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2"),
).toString("base64");
const executablePath =
  process.env.YAMT_E2E_CHROMIUM ??
  (existsSync(".chromium/bin/chromium") ? ".chromium/bin/chromium" : undefined);

/** `inset`: the share of the canvas the mark may use (maskable icons keep to the inner 80 %). */
const icons = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "apple-touch-icon.png", size: 180, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.78 },
];

const page = (size: number, scale: number) => `<!doctype html><html><head><style>
@font-face { font-family: SG; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 300 700; }
html, body { margin: 0; }
body { width: ${size}px; height: ${size}px; background: oklch(0.9 0.21 125); display: flex;
  align-items: center; justify-content: center; overflow: hidden; }
span { font: 700 ${Math.round(size * 0.9 * scale)}px/1 SG; letter-spacing: -0.04em; color: oklch(0.15 0 0);
  transform: translateY(-${Math.round(size * 0.12 * scale)}px); }
</style></head><body><span>y</span></body></html>`;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const { file, size, scale } of icons) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent(page(size, scale));
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(out, file), omitBackground: false });
    await p.close();
    console.log(`${file} ${size}×${size}`);
  }
  const p = await browser.newPage();
  const hex = await p.evaluate(() =>
    ["oklch(0.985 0.005 95)", "oklch(0.13 0 0)"].map((c) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `${c} = #${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
    }),
  );
  console.log(hex.join("\n"));
} finally {
  await browser.close();
}
