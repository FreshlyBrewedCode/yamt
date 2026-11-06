import { NIGHTLY_OFF } from "../domain/nightly.ts";
import type { JobHandler, JobOf, JobOutcome } from "../jobs/worker.ts";
import type { Services } from "../services.ts";

/**
 * The scheduled `nightly` job (#48): reads the nightly setting when it runs (off: nothing), makes
 * today's nightly request with its first round (`NightlyService.run`; nothing when today is all
 * eaten or planned), and once it has ended for good queues the next day's (`schedule`). A server
 * that was down at the time runs it at the next start. Concurrency 1, its own lane.
 */
export class NightlyJob implements JobHandler<"nightly"> {
  readonly type = "nightly";
  readonly concurrency = 1;

  constructor(private readonly s: Services) {}

  async run(_job: JobOf<"nightly">): Promise<JobOutcome> {
    if (!this.s.nightly.settings().enabled) return { status: "cancelled", reason: NIGHTLY_OFF };
    this.s.nightly.run();
    return { status: "done" };
  }

  settled(job: JobOf<"nightly">): void {
    // a retry is still today's; anything final makes way for the next day's
    if (job.status !== "queued") this.s.nightly.schedule();
  }
}
