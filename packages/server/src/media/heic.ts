/**
 * HEIC/HEIF → JPEG, for browsers that cannot show HEIC and for the agent. Pure JS/WASM (libheif
 * via `heic-decode`, `jpeg-js`), so it needs no system library; a 12 MP iPhone photo takes about
 * 1.5 s on the VM. Loaded lazily: the WASM bundle is large and most photos arrive as JPEG.
 */
export async function heicToJpeg(bytes: Uint8Array, quality = 85): Promise<Uint8Array> {
  const [{ default: decode }, { encode }] = await Promise.all([import("heic-decode"), import("jpeg-js")]);
  const image = await decode({ buffer: bytes });
  return new Uint8Array(encode({ data: image.data, width: image.width, height: image.height }, quality).data);
}
