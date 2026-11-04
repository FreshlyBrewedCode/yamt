import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHealth } from "@/lib/queries";

export const Route = createFileRoute("/")({ component: Home });

/** Placeholder home: proves the shell, the API and the theme. Meal capture replaces it (epic #2). */
function Home() {
  const health = useHealth();
  const status = health.isPending ? "Connecting…" : health.isSuccess ? "Server online" : "Server offline";

  return (
    <>
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="font-semibold text-2xl tracking-tight">yamt</h1>
        <Badge variant={health.isError ? "destructive" : "secondary"} data-testid="server-status">
          {status}
        </Badge>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 py-2">
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>Nothing logged yet.</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Capture a meal by voice, photo, text or link; an agent works out the macros afterwards.
          </CardContent>
        </Card>
      </main>
      <footer className="sticky bottom-0 bg-background/80 px-4 pt-2 pb-4 backdrop-blur">
        <Button size="lg" className="w-full" disabled>
          <Plus />
          Log meal
        </Button>
        {health.data && (
          <p className="pt-2 text-center text-muted-foreground text-xs">v{health.data.version}</p>
        )}
      </footer>
    </>
  );
}
