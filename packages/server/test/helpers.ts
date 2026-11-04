import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temp dir; tests never touch the real ~/.yamt. */
export const tempDir = (prefix = "yamt-test-"): string => mkdtempSync(join(tmpdir(), prefix));
