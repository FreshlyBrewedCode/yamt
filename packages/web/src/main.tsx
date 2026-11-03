import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startOutbox } from "./lib/outbox";
import { queryClient } from "./lib/queries";
import "./lib/sw";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// A lazy route chunk of an older build is gone after an update: load the new build instead.
addEventListener("vite:preloadError", () => location.reload());

// pending uploads from an earlier visit go out now
startOutbox();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
