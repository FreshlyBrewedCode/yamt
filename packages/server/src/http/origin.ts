/**
 * The hosts the request was addressed to: behind `tailscale serve` (or the Vite dev proxy) the
 * public host arrives as Host or X-Forwarded-Host.
 */
function requestHosts(req: Request): string[] {
  return [req.headers.get("host"), req.headers.get("x-forwarded-host")]
    .filter((h): h is string => !!h)
    .flatMap((h) => h.split(",").map((x) => x.trim()));
}

/**
 * True if the request carries an Origin of our own host. Browsers send Origin on every fetch and
 * XHR write, same-origin ones included (and on cross-site requests and WebSocket handshakes), so
 * a write without one didn't come from our page; `null` (sandboxed frames, opaque redirects)
 * isn't ours either.
 */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return requestHosts(req).includes(originHost);
}

/**
 * The origin the client used, e.g. `https://yamt.example.ts.net:7444`: the forwarded host and
 * protocol behind `tailscale serve` (which terminates TLS, so a `.ts.net` host is https), else
 * the request's own.
 */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded || (/\.ts\.net(:\d+)?$/i.test(host) ? "https" : url.protocol.replace(":", ""));
  return `${proto}://${host}`;
}
