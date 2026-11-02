import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev mode (`yamt start --dev`): Vite serves the SPA with HMR and proxies the API to the app
// server. The proxy keeps the request's headers (Host, Origin, Tailscale-User-Login), so auth and
// the same-origin check behave as in production.
const apiPort = process.env.YAMT_API_PORT ?? "7890";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
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
