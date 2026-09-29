/**
 * Finds messages stranded by queue data loss and closes them out.
 *
 *   npm run reconcile              # dry run: report only
 *   npm run reconcile -- --apply   # mark stranded logs failed (JOB_LOST)
 *
 * See docs/operations/BACKUP-RECOVERY.md.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

void (async () => {
  const apply = process.argv.includes("--apply");
  const { reconcileStrandedLogs } = await import("@/server/reconcile");
  const { closeSendQueue } = await import("@/lib/queue/send-queue");
  const report = await reconcileStrandedLogs({ dryRun: !apply });
  console.log(JSON.stringify({ event: "reconcile.stranded_logs", ...report, stranded: report.stranded.length }));
  await closeSendQueue();
  process.exit(0);
})();
