import type { MiddlewareHandler } from "hono";
import { HttpError } from "../domain/errors.ts";

/**
 * Bearer-token auth for machine clients that don't come through `tailscale serve`: the MCP
 * endpoint (`/mcp`, epic #2) is called over loopback by agent runs (a per-run token) and by
 * interactive sessions via `.mcp.json`. The verifier owns token storage and comparison (store
 * hashes, not tokens) and returns who the token belongs to, or null.
 */
export type TokenVerifier<P> = (token: string) => P | null | Promise<P | null>;

/** `c.get("principal")`: what the verifier returned for the token. */
export type BearerEnv<P> = { Variables: { principal: P } };

export function requireBearer<P>(verify: TokenVerifier<P>): MiddlewareHandler<BearerEnv<P>> {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("Authorization") ?? "");
    const principal = match?.[1] ? await verify(match[1]) : null;
    if (principal === null) {
      c.header("WWW-Authenticate", 'Bearer realm="yamt"');
      throw new HttpError(401, "missing or invalid bearer token");
    }
    c.set("principal", principal);
    await next();
  };
}
