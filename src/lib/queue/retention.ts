/**
 * How long job data (which includes message bodies) stays in the queue.
 *
 * A standalone module with no imports, so the Privacy Policy page can quote the
 * real numbers without pulling the queue client into its bundle. The queue's
 * default job options and `tests/unit/legal.test.ts` both read these, so the
 * policy cannot drift from what the queue does.
 */
export const COMPLETED_JOB_RETENTION_HOURS = 24;
export const FAILED_JOB_RETENTION_DAYS = 14;
