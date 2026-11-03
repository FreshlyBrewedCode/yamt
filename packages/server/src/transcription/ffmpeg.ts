import { tail } from "./tools.ts";

/**
 * ffmpeg arguments that turn any audio the phone sends (Safari's MediaRecorder `audio/mp4`, Voice
 * Memos `.m4a`, WebM/Ogg, MP3, WAV…) into what the STT reads: 16 kHz mono 16-bit PCM WAV. Only
 * the first audio stream; video, cover art and metadata are dropped. The input is only read.
 */
export function normaliseArgs(input: string, output: string): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    "-y",
    output,
  ];
}

export class NormaliseError extends Error {
  override name = "NormaliseError";
  constructor(
    message: string,
    /** False when ffmpeg ran and refused the file: a broken file stays broken. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Runs ffmpeg once; throws a NormaliseError with ffmpeg's own words. */
export async function normalise(
  ffmpeg: string,
  input: string,
  output: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  const p = Bun.spawn([ffmpeg, ...normaliseArgs(input, output)], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    signal: opts.signal,
    timeout: opts.timeoutMs ?? 5 * 60_000,
  });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  if (code === 0) return;
  if (opts.signal?.aborted) throw new NormaliseError("ffmpeg: aborted", true);
  if (p.signalCode) throw new NormaliseError(`ffmpeg was stopped (${p.signalCode}): ${tail(err)}`, true);
  throw new NormaliseError(`ffmpeg can't read the audio (exit ${code}): ${tail(err) || "no output"}`, false);
}
