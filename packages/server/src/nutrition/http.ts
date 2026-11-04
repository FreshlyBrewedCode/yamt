import { VERSION } from "../config.ts";

/** Open Food Facts asks for an identifying User-Agent; everyone else gets the same one. */
export const USER_AGENT = `yamt/${VERSION} (https://github.com/FreshlyBrewedCode/yamt)`;

/** The fetch the clients use; tests pass one that answers from recorded fixtures. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** An outbound call failed (network, timeout, HTTP status, too large); the message says which. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    /** The HTTP status, if the server answered. */
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/**
 * A token bucket: `capacity` calls at once, refilled at one per `intervalMs`. `take()` resolves
 * when a call may go out, so bursts are fine and a sustained rate stays polite.
 */
export class RateLimiter {
  private tokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly capacity: number,
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<unknown> = Bun.sleep,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(): Promise<void> {
    // one waiter at a time, in call order
    const next = this.queue.then(async () => {
      this.refill();
      if (this.tokens < 1) {
        await this.sleep(Math.ceil((1 - this.tokens) * this.intervalMs));
        this.refill();
      }
      this.tokens -= 1;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  private refill(): void {
    const now = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) / this.intervalMs);
    this.last = now;
  }
}

export interface GetOptions {
  timeoutMs: number;
  /** Larger bodies are refused (read in chunks, so a huge one is never buffered). */
  maxBytes: number;
  limiter?: RateLimiter;
  headers?: Record<string, string>;
  /** Checked for the URL and every redirect target; throws to refuse it. */
  checkUrl?: (url: URL) => void;
}

const MAX_REDIRECTS = 5;

/**
 * GET with a timeout, a size cap and the yamt User-Agent. Non-2xx answers throw an
 * UpstreamError carrying the status (callers treat 404 as "not found").
 */
export async function getText(
  fetchFn: Fetch,
  url: string,
  opts: GetOptions,
): Promise<{ text: string; res: Response; url: string }> {
  await opts.limiter?.take();
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let current = new URL(url);
  let res: Response;
  for (let hop = 0; ; hop++) {
    opts.checkUrl?.(current);
    try {
      res = await fetchFn(current.toString(), {
        headers: { "User-Agent": USER_AGENT, ...opts.headers },
        signal,
        // followed here, so every target passes checkUrl
        redirect: "manual",
      });
    } catch (e) {
      const err = e as Error;
      throw new UpstreamError(
        err.name === "TimeoutError" || err.name === "AbortError"
          ? `no answer within ${opts.timeoutMs / 1000} s`
          : // never echo an API key a runtime error message might quote from the URL
            `request failed: ${err.message.replace(/api_key=[^&\s]+/gi, "api_key=…")}`,
      );
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new UpstreamError(`more than ${MAX_REDIRECTS} redirects`);
    current = new URL(location, current);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new UpstreamError(`HTTP ${res.status}`, res.status);
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (declared > opts.maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new UpstreamError(`the response is larger than ${opts.maxBytes} bytes`);
  }
  try {
    return { text: await readCapped(res, opts.maxBytes), res, url: current.toString() };
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError(`reading the answer failed: ${(e as Error).message}`);
  }
}

export async function getJson(fetchFn: Fetch, url: string, opts: GetOptions): Promise<unknown> {
  const { text } = await getText(fetchFn, url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError("the answer is not JSON");
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UpstreamError(`the response is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
