#!/usr/bin/env bun
// Stands in for ffmpeg in the transcription tests: takes the input after -i and writes the last
// argument as a 16 kHz mono 16-bit WAV of silence, 0.5 s per KB of input. An input that starts
// with "junk" is refused the way ffmpeg refuses a broken file.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const input = args[args.indexOf("-i") + 1]!;
const output = args.at(-1)!;
const bytes = readFileSync(input);
if (bytes.subarray(0, 4).toString() === "junk") {
  process.stderr.write(`${input}: Invalid data found when processing input\n`);
  process.exit(183);
}
const samples = Math.round((bytes.length / 1024) * 0.5 * 16000);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + samples * 2, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(16000, 24);
header.writeUInt32LE(32000, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(samples * 2, 40);
writeFileSync(output, Buffer.concat([header, Buffer.alloc(samples * 2)]));
