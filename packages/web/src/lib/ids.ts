/**
 * A UUIDv7 (RFC 9562): 48 bits of milliseconds, a 12-bit counter, then random bits. Ids made by
 * this page sort by creation time like the server's, also several within one millisecond (the
 * counter, RFC 9562 method 1). The web app picks the ids of the meals and captures it creates,
 * which makes every create idempotent (the upload queue can retry after a lost response).
 */
let lastMs = 0;
let counter = 0;

export function uuidv7(now = Date.now()): string {
  let ms = Math.max(now, lastMs);
  if (ms === lastMs) {
    counter++;
    if (counter > 0xfff) {
      ms++;
      counter = 0;
    }
  } else {
    counter = Math.floor(Math.random() * 0x400); // leave room to count up within the millisecond
  }
  lastMs = ms;
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = 0x70 | (counter >> 8);
  b[7] = counter & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
