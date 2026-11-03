import { describe, expect, test } from "bun:test";
import {
  capturesFromItems,
  capturesFromPaste,
  pastedName,
  pasteFromClipboard,
  readClipboardItems,
  sniffMime,
} from "../src/lib/clipboard";

// Made-up clipboard contents: a 1×1 PNG, bytes with an .m4a header (as Voice Memos makes), text.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const M4A = new Uint8Array([
  ...new TextEncoder().encode("\0\0\0\x14ftypM4A \0\0\0\0M4A "),
  ...new Uint8Array(64),
]);
const AT = new Date(2026, 10, 3, 19, 10).getTime();

const png = (type = "image/png") => new Blob([PNG], { type });
const text = (s: string, type = "text/plain") => new Blob([s], { type });

describe("clipboard items → captures", () => {
  test("a screenshot is an image; a link alone is a link; other text a note", async () => {
    const res = await capturesFromItems(
      [
        [{ type: "image/png", data: png() }],
        [
          { type: "text/plain", data: text("https://example.com/rezept/kuerbis-curry") },
          { type: "text/uri-list", data: text("https://example.com/rezept/kuerbis-curry", "text/uri-list") },
        ],
        [{ type: "text/plain", data: text("  2 Scheiben Roggenbrot mit Butter \n") }],
        [{ type: "text/plain", data: text("Rezept: https://example.com/x, aber mit weniger Öl") }],
      ],
      AT,
    );
    expect(res.captures).toEqual([
      {
        kind: "image",
        blob: expect.any(Blob),
        mimeType: "image/png",
        fileName: "pasted-2026-11-03-1910.png",
      },
      { kind: "link", url: "https://example.com/rezept/kuerbis-curry" },
      { kind: "text", text: "2 Scheiben Roggenbrot mit Butter" },
      { kind: "text", text: "Rezept: https://example.com/x, aber mit weniger Öl" },
    ]);
    expect(res.offered).toEqual(["image/png", "text/plain", "text/uri-list"]);
  });

  test("one item offered as several types gives one capture, the richest", async () => {
    // Safari copying an image from a page: the picture, its URL and some HTML
    const res = await capturesFromItems(
      [
        [
          { type: "text/html", data: text('<img src="https://example.com/a.png">', "text/html") },
          { type: "text/uri-list", data: text("https://example.com/a.png", "text/uri-list") },
          { type: "image/png", data: png() },
        ],
      ],
      AT,
    );
    expect(res.captures.map((c) => c.kind)).toEqual(["image"]);
  });

  test("audio, if the clipboard offers it: by MIME type, by Apple's type identifier, by name or bytes", async () => {
    const m4a = (type: string) => new Blob([M4A], { type });
    const res = await capturesFromItems(
      [
        [{ type: "audio/x-m4a", data: m4a("audio/x-m4a") }],
        [{ type: "com.apple.m4a-audio", data: m4a("") }],
        [{ type: "", data: m4a(""), name: "New Recording 12.m4a" }],
        [{ type: "application/octet-stream", data: m4a("application/octet-stream") }],
      ],
      AT,
    );
    expect(res.captures.map((c) => ("blob" in c ? [c.kind, c.mimeType, c.fileName] : c.kind))).toEqual([
      ["audio", "audio/x-m4a", "pasted-2026-11-03-1910.m4a"],
      ["audio", "audio/mp4", "pasted-2026-11-03-1910.m4a"],
      ["audio", "audio/mp4", "New Recording 12.m4a"],
      ["audio", "audio/mp4", "pasted-2026-11-03-1910.m4a"],
    ]);
  });

  test("HTML alone gives its text; a uri-list with one URL a link, comments aside", async () => {
    const res = await capturesFromItems([
      [
        {
          type: "text/html",
          data: text("<p>Linsen&nbsp;Curry</p><p>mit Reis &amp; Joghurt</p>", "text/html"),
        },
      ],
      [{ type: "text/uri-list", data: text("# from Safari\r\nhttps://example.com/b\r\n", "text/uri-list") }],
    ]);
    expect(res.captures).toEqual([
      { kind: "text", text: "Linsen Curry\nmit Reis & Joghurt" },
      { kind: "link", url: "https://example.com/b" },
    ]);
  });

  test("nothing usable: no captures, but every type that was offered", async () => {
    const res = await capturesFromItems([
      [
        { type: "com.apple.m4a-audio", data: "" },
        { type: "text/plain", data: text("   ") },
      ],
      [{ type: "application/pdf", data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]) }],
    ]);
    expect(res.captures).toEqual([]);
    expect(res.offered).toEqual(["com.apple.m4a-audio", "text/plain", "application/pdf"]);
  });
});

describe("paste events", () => {
  test("files count first; the strings only without a usable file", async () => {
    const file = new File([M4A], "New Recording.m4a", { type: "" });
    const withFile = await capturesFromPaste(
      [[{ type: file.type, data: file, name: file.name }]],
      [{ type: "text/plain", data: "New Recording.m4a" }],
      AT,
    );
    expect(withFile.captures.map((c) => c.kind)).toEqual(["audio"]);
    expect(withFile.offered).toEqual(["a file without a type (New Recording.m4a)", "text/plain"]);

    const onlyText = await capturesFromPaste([], [{ type: "text/plain", data: "https://example.com/c" }], AT);
    expect(onlyText.captures).toEqual([{ kind: "link", url: "https://example.com/c" }]);

    const nothing = await capturesFromPaste([], [{ type: "com.apple.m4a-audio", data: "" }], AT);
    expect(nothing).toEqual({ captures: [], offered: ["com.apple.m4a-audio"] });
  });
});

describe("the Paste button (navigator.clipboard.read)", () => {
  const item = (types: Record<string, Blob>) =>
    ({
      types: Object.keys(types),
      getType: async (t: string) => {
        const b = types[t];
        if (!b) throw new DOMException("not there", "NotFoundError");
        return b;
      },
    }) as unknown as ClipboardItem;

  test("reads every type of every item", async () => {
    const items = await readClipboardItems([item({ "image/png": png(), "text/plain": text("x") })]);
    expect(items[0]?.map((d) => d.type)).toEqual(["image/png", "text/plain"]);
  });

  test("captures when something is usable; otherwise why not, for the fallback sheet", async () => {
    const read = (r: () => Promise<ClipboardItem[]>) => ({ read: r });
    const ok = await pasteFromClipboard(read(async () => [item({ "image/png": png() })]));
    expect("captures" in ok && ok.captures.map((c) => c.kind)).toEqual(["image"]);
    expect(await pasteFromClipboard(undefined)).toEqual({ reason: "unsupported" });
    expect(await pasteFromClipboard({} as Clipboard)).toEqual({ reason: "unsupported" });
    expect(
      await pasteFromClipboard(
        read(async () => {
          throw new DOMException("dismissed", "NotAllowedError");
        }),
      ),
    ).toEqual({ reason: "denied" });
    expect(
      await pasteFromClipboard(read(async () => [item({ "text/html": text("", "text/html") })])),
    ).toEqual({
      reason: "nothing",
      offered: ["text/html"],
    });
  });
});

test("sniffing and names", async () => {
  expect(await sniffMime(new Blob([PNG]))).toBe("image/png");
  expect(await sniffMime(new Blob([M4A]))).toBe("audio/mp4");
  expect(await sniffMime(new Blob(["hello"]))).toBeNull();
  expect(pastedName("image/jpeg", AT)).toBe("pasted-2026-11-03-1910.jpg");
});
