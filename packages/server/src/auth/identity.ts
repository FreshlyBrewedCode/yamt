import type { MiddlewareHandler } from "hono";
import { HttpError } from "../domain/errors.ts";

/** Set by `tailscale serve` on every proxied request from a user-owned device (not tagged ones). */
export const IDENTITY_HEADER = "Tailscale-User-Login";

/**
 * How browser-facing requests are authenticated:
 * - `tailnet`: the request must carry `Tailscale-User-Login` matching `login` (null = none
 *   configured, so everything is refused).
 * - `off`: explicit dev bypass (`start --local --no-auth`); only ever on a loopback-only server.
 */
export type AuthMode = { kind: "tailnet"; login: string | null } | { kind: "off" };

/** `c.get("login")`: who made the request (`local` when auth is off). */
export type IdentityEnv = { Variables: { login: string } };

/**
 * 401 unless the request comes through `tailscale serve` from the configured login. The server
 * binds loopback only, so the header can only be set by the proxy or by a process on this
 * machine (docs/adr/0001-wave-1-architecture.md). Logins compare case-insensitively.
 */
export function requireTailnetIdentity(mode: AuthMode): MiddlewareHandler<IdentityEnv> {
  return async (c, next) => {
    if (mode.kind === "off") {
      c.set("login", "local");
      return next();
    }
    if (!mode.login) {
      throw new HttpError(401, "no login configured", "set YAMT_LOGIN or `login` in <data>/config.json");
    }
    const login = c.req.header(IDENTITY_HEADER)?.trim();
    if (!login) throw new HttpError(401, "no Tailscale identity: open yamt through its tailnet HTTPS URL");
    if (login.toLowerCase() !== mode.login.toLowerCase()) {
      throw new HttpError(401, `${login} is not allowed here`);
    }
    c.set("login", login);
    await next();
  };
}
