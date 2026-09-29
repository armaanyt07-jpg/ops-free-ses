/**
 * Re-encrypts every stored AWS credential under the current ENCRYPTION_KEY.
 *
 * Rotation procedure (docs/operations/BACKUP-RECOVERY.md §Key rotation):
 *   1. set ENCRYPTION_KEY_PREVIOUS = the old key, ENCRYPTION_KEY = a new one;
 *      deploy app and worker (both read either key from then on);
 *   2. run this script — idempotent, safe to re-run;
 *   3. when it reports failed = 0, remove ENCRYPTION_KEY_PREVIOUS and deploy.
 *
 *   npm run rotate:encryption-key
 */
import { config } from "dotenv";

config({ path: ".env.local" });

void (async () => {
  const { reencryptAllCredentials } = await import("@/server/credentials");
  const result = await reencryptAllCredentials();
  console.log(JSON.stringify({ event: "encryption_key.rotation", ...result }));
  process.exit(result.failed > 0 ? 1 : 0);
})();
