import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import webpush from "web-push";
import { z } from "zod";

/** The server's VAPID key pair (base64url, P-256): the public one is the app's `applicationServerKey`. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const VapidFile = z.object({
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  privateKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  createdAt: z.number().optional(),
});

/**
 * The VAPID keys in `<data>/vapid.json` (0600), generated on first use and kept from then on:
 * every subscription is bound to the public key, so a new pair would silence every phone until
 * it subscribes again. A file that can't be read is an error, never silently replaced.
 */
export function loadVapidKeys(path: string, now = Date.now()): VapidKeys {
  if (existsSync(path)) {
    const parsed = VapidFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) {
      throw new Error(
        `${path}: not a VAPID key pair (move it away to make a new one; phones subscribe again)`,
      );
    }
    chmodSync(path, 0o600);
    return { publicKey: parsed.data.publicKey, privateKey: parsed.data.privateKey };
  }
  const keys = webpush.generateVAPIDKeys();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...keys, createdAt: now }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}
