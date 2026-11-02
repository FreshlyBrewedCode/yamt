import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { dataPaths } from "../config.ts";

/**
 * Raw media under `<data>/media/<yyyy>/<mm>/<capture id>.<ext>` (UTC month of arrival), written
 * once and never modified: files are created exclusively (0600, dirs 0700) via a temp file and a
 * rename, so a crash never leaves half a file under the final name. Paths in the database are
 * relative to the data dir, so the data dir can move.
 */
export class MediaStore {
  constructor(private readonly dataDir: string) {}

  /** `media/2026/11/<id>.<ext>` */
  pathFor(id: string, ext: string, at: number): string {
    const d = new Date(at);
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return ["media", yyyy, mm, `${id}.${ext}`].join("/");
  }

  /** Absolute path of a stored file; refuses anything outside `<data>/media`. */
  absolute(relPath: string): string {
    const media = resolve(dataPaths(this.dataDir).media);
    const abs = resolve(this.dataDir, relPath);
    if (!abs.startsWith(media + sep)) throw new Error(`media path outside the media dir: ${relPath}`);
    return abs;
  }

  /** Writes new bytes under `relPath`; fails if the file exists. Returns size and SHA-256. */
  async write(relPath: string, bytes: Uint8Array): Promise<{ byteSize: number; sha256: string }> {
    const abs = this.absolute(relPath);
    await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
    const tmp = `${abs}.part`;
    await writeFile(tmp, bytes, { mode: 0o600, flag: "wx" });
    try {
      // originals are never replaced (rename would overwrite silently)
      if (await Bun.file(abs).exists()) throw new Error(`media file exists: ${relPath}`);
      await rename(tmp, abs);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return { byteSize: bytes.byteLength, sha256: sha256Hex(bytes) };
  }

  /** Only for undoing a write whose capture was never recorded. */
  async remove(relPath: string): Promise<void> {
    await rm(this.absolute(relPath), { force: true });
  }
}

export const sha256Hex = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
