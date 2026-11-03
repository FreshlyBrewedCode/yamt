import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Dev mode (`yamt start --dev`): Vite serves the SPA with HMR and proxies the API to the app
// server. The proxy keeps the request's headers (Host, Origin, Tailscale-User-Login), so auth and
// the same-origin check behave as in production.
const apiPort = process.env.YAMT_API_PORT ?? "7890";

/** The service worker template with its version and precache list (null: no shell cache). */
const renderServiceWorker = (version: string, files: string[] | null) =>
  readFileSync(resolve(import.meta.dirname, "sw.js"), "utf8")
    .replace('"__YAMT_SW_VERSION__"', JSON.stringify(version))
    .replace("__YAMT_SW_PRECACHE__", JSON.stringify(files));

/**
 * Emits /sw.js from the template in `sw.js`: the build's files as the precache list and a
 * version derived from them, so every build with changed files installs a new worker. Dev
 * serves it without a file list: no shell cache (Vite serves fresh files), push only, so Web
 * Push can be tried with `yamt start --dev` too.
 */
function serviceWorker(): Plugin {
  return {
    name: "yamt-service-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/sw.js") return next();
        res.setHeader("content-type", "text/javascript");
        res.setHeader("cache-control", "no-cache");
        res.end(renderServiceWorker("dev", null));
      });
    },
    generateBundle(_options, bundle) {
      // public/ is copied as it is and not part of the bundle: list it too (icons, manifest)
      const publicFiles = readdirSync(resolve(import.meta.dirname, "public"), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((d) => d.isFile())
        .map((d) => `${d.parentPath}/${d.name}`.slice(resolve(import.meta.dirname, "public").length + 1));
      const files = [...Object.keys(bundle), ...publicFiles]
        .filter((f) => f !== "index.html" && !f.endsWith(".map"))
        .sort();
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: renderServiceWorker(version, files) });
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    serviceWorker(),
  ],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: {
    host: "127.0.0.1",
    // tailscale serve forwards the tailnet hostname
    allowedHosts: [".ts.net", "localhost"],
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}` },
    },
  },
});
