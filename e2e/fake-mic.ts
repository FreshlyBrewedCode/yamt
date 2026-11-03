import { writeFileSync } from "node:fs";

/**
 * A made-up microphone signal for Chromium's fake capture device
 * (`--use-file-for-fake-audio-capture`): a few seconds of a warbling tone as 16 kHz mono PCM WAV.
 */
export function writeFakeMic(path: string, seconds = 6): string {
  const rate = 16000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const loudness = 0.3 + 0.7 * Math.abs(Math.sin(t * 3));
    const v = Math.sin(2 * Math.PI * (220 + 60 * Math.sin(t * 5)) * t) * 12000 * loudness;
    b.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  writeFileSync(path, b);
  return path;
}
