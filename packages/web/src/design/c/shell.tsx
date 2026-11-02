import type { ReactNode } from "react";
import "./theme.css";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="design-c flex min-h-[inherit] flex-col bg-background font-sans text-foreground tabular-nums">
      {children}
    </div>
  );
}
