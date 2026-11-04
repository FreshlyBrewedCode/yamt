/**
 * Process-group hygiene for the harnesses the server spawns (ported from vibe-center's
 * `procs.ts`, without its crash registry: a harness whose server died loses its stdin and
 * exits). `stopGroup` stops a whole group: SIGTERM, then SIGKILL to the group after a grace
 * period, whether or not the leader has exited by then, so children that ignore SIGTERM (Claude
 * Code's binary, MCP servers) don't survive.
 */
export async function stopGroup(pgid: number, graceMs = 2000): Promise<void> {
  if (!groupAlive(pgid)) return;
  signal(-pgid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (groupAlive(pgid) && Date.now() < deadline) await Bun.sleep(20);
  if (!groupAlive(pgid)) return;
  signal(-pgid, "SIGKILL");
  const last = Date.now() + 1000;
  while (groupAlive(pgid) && Date.now() < last) await Bun.sleep(10);
}

/** True while any process is in the group (zombies awaiting their reaper included). */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signal(target: number, sig: NodeJS.Signals): void {
  try {
    process.kill(target, sig);
  } catch {}
}
