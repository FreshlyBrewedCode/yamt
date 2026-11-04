import { accessSync, constants, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { STT_RUNNER } from "../config.ts";

/** A tool the transcription needs is missing; retrying won't help until someone installs it. */
export class ToolMissingError extends Error {
  override name = "ToolMissingError";
}

export interface FfmpegLookup {
  /** An explicit path (config `transcription.ffmpeg`, env YAMT_FFMPEG); must exist. */
  configured: string | null;
  /** Where a nixpkgs ffmpeg is linked (`nix build … -o <link>` makes `<link>-bin`). */
  nixLink?: string;
  which?: (cmd: string) => string | null;
  log?: (line: string) => void;
}

/** services/stt/.ffmpeg → services/stt/.ffmpeg-bin/bin/ffmpeg */
export const NIX_FFMPEG_LINK = join(dirname(STT_RUNNER), ".ffmpeg");

/**
 * Finds ffmpeg: the configured path, else PATH, else a nixpkgs ffmpeg linked into services/stt
 * (built on first use when `nix` is there, as run.sh does for uv). This VM (NixOS) has neither
 * ffmpeg nor uv on PATH; CI installs ffmpeg with apt.
 */
export async function resolveFfmpeg(o: FfmpegLookup): Promise<string> {
  if (o.configured) {
    if (!isExecutable(o.configured)) {
      throw new ToolMissingError(`ffmpeg not found at ${o.configured} (transcription.ffmpeg / YAMT_FFMPEG)`);
    }
    return o.configured;
  }
  const which = o.which ?? ((cmd: string) => Bun.which(cmd));
  const onPath = which("ffmpeg");
  if (onPath) return onPath;
  const link = o.nixLink ?? NIX_FFMPEG_LINK;
  const linked = join(`${link}-bin`, "bin", "ffmpeg");
  if (isExecutable(linked)) return linked;
  if (which("nix")) {
    (o.log ?? console.log)("transcription: ffmpeg is not on PATH, linking it from nixpkgs (first use)…");
    const p = Bun.spawn(["nix", "build", "nixpkgs#ffmpeg-headless.bin", "-o", link], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
    if (code === 0 && isExecutable(linked)) return linked;
    throw new ToolMissingError(`ffmpeg: \`nix build nixpkgs#ffmpeg-headless.bin\` failed: ${tail(err)}`);
  }
  throw new ToolMissingError(
    "ffmpeg not found: install it (apt install ffmpeg), or set transcription.ffmpeg in config.json or YAMT_FFMPEG",
  );
}

function isExecutable(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export const tail = (s: string, max = 600): string => {
  const t = s.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
};
