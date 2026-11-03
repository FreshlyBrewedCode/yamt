import exifr from "exifr";

/** Long edge of the copy a photo is sent to the model as (Claude downsizes beyond ~1568 px anyway). */
export const AGENT_IMAGE_EDGE = 1600;

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8Array;
}

/**
 * A JPEG for the model: at most `maxEdge` px on the long side, upright (EXIF orientation applied,
 * since the re-encoded copy has no EXIF), quality 85. Pure JS (`jpeg-js`, loaded lazily), no
 * system library, like the HEIC conversion. Returns the input itself when it is small enough and
 * already upright.
 */
export async function downscaleJpeg(
  bytes: Uint8Array,
  maxEdge = AGENT_IMAGE_EDGE,
  quality = 85,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { decode, encode } = await import("jpeg-js");
  const orientation = (await exifr.orientation(bytes).catch(() => undefined)) ?? 1;
  const image = decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 200,
    maxMemoryUsageInMB: 1024,
  });
  if (Math.max(image.width, image.height) <= maxEdge && orientation === 1) {
    return { bytes, width: image.width, height: image.height };
  }
  const small = reorient(boxResize(image, maxEdge), orientation);
  const out = encode({ data: small.data, width: small.width, height: small.height }, quality).data;
  return { bytes: new Uint8Array(out), width: small.width, height: small.height };
}

/** Area-averaging downscale so the long edge is at most `maxEdge` (never upscales). */
export function boxResize(src: Raster, maxEdge: number): Raster {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  if (scale === 1) return src;
  const tw = Math.max(1, Math.round(src.width * scale));
  const th = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8Array(tw * th * 4);
  const xs = new Int32Array(tw + 1);
  for (let x = 0; x <= tw; x++) xs[x] = Math.min(src.width, Math.floor((x * src.width) / tw));
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * src.height) / th);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor(((ty + 1) * src.height) / th)));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = xs[tx]!;
      const x1 = Math.max(x0 + 1, xs[tx + 1]!);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * src.width + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          r += src.data[i]!;
          g += src.data[i + 1]!;
          b += src.data[i + 2]!;
          a += src.data[i + 3]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (ty * tw + tx) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: tw, height: th, data: out };
}

/** Applies an EXIF orientation (1–8), so the pixels stand the way the camera meant them to. */
export function reorient(src: Raster, orientation: number): Raster {
  if (orientation < 2 || orientation > 8) return src;
  const { width: W, height: H } = src;
  const swap = orientation > 4;
  const dw = swap ? H : W;
  const dh = swap ? W : H;
  const out = new Uint8Array(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2:
          sx = W - 1 - dx;
          sy = dy;
          break;
        case 3:
          sx = W - 1 - dx;
          sy = H - 1 - dy;
          break;
        case 4:
          sx = dx;
          sy = H - 1 - dy;
          break;
        case 5:
          sx = dy;
          sy = dx;
          break;
        case 6:
          sx = dy;
          sy = H - 1 - dx;
          break;
        case 7:
          sx = W - 1 - dy;
          sy = H - 1 - dx;
          break;
        default: // 8
          sx = W - 1 - dy;
          sy = dx;
      }
      const s = (sy * W + sx) * 4;
      const d = (dy * dw + dx) * 4;
      out[d] = src.data[s]!;
      out[d + 1] = src.data[s + 1]!;
      out[d + 2] = src.data[s + 2]!;
      out[d + 3] = src.data[s + 3]!;
    }
  }
  return { width: dw, height: dh, data: out };
}
