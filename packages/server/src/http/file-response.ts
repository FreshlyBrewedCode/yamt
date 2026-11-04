/** Media types a browser may show inline; everything else downloads (no HTML/SVG on our origin). */
const INLINE = /^(image\/(jpeg|png|gif|webp|heic|heif|avif)|audio\/|video\/|application\/pdf$)/;

export interface StoredFile {
  path: string;
  mimeType: string;
  byteSize: number;
  etag: string;
  /** Suggested download name (ASCII, no quotes). */
  downloadName: string;
}

/**
 * Serves an immutable stored file with single-range support (`Range: bytes=…`), which Safari
 * needs to play and seek audio. Uploaded content is never trusted: `nosniff`, a sandboxing CSP,
 * and anything not plainly media as an attachment.
 */
export function fileResponse(req: Request, f: StoredFile): Response {
  const headers = new Headers({
    "Content-Type": f.mimeType,
    "Accept-Ranges": "bytes",
    ETag: f.etag,
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `${INLINE.test(f.mimeType) ? "inline" : "attachment"}; filename="${f.downloadName}"`,
  });
  if (req.headers.get("if-none-match") === f.etag) return new Response(null, { status: 304, headers });

  const file = Bun.file(f.path);
  const range = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  if (range && (!ifRange || ifRange === f.etag)) {
    const r = parseRange(range, f.byteSize);
    if (r === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${f.byteSize}`);
      return new Response(null, { status: 416, headers });
    }
    if (r) {
      headers.set("Content-Range", `bytes ${r.start}-${r.end}/${f.byteSize}`);
      headers.set("Content-Length", String(r.end - r.start + 1));
      return new Response(file.slice(r.start, r.end + 1), { status: 206, headers });
    }
  }
  headers.set("Content-Length", String(f.byteSize));
  return new Response(file, { status: 200, headers });
}

/**
 * One `bytes=` range → inclusive offsets. Null for anything we don't handle (multiple ranges,
 * other units, garbage): the caller sends the whole file, which RFC 9110 allows.
 */
export function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (m[2] !== "" && Number(m[2]) < start) return null;
  }
  if (start >= size) return "unsatisfiable";
  return { start, end };
}
