// heic-decode 2.1.0 ships no types. Decodes the primary image of a HEIC/HEIF file to RGBA.
declare module "heic-decode" {
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  export default function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedImage>;
}
