import "server-only";

import type { Environment } from "@/db/schema";

/**
 * The dashboard's environment.
 *
 * Phase 8 product decision: there is one environment, production. Staging
 * (SRS "Staging and Production environments") confused new users more than it
 * helped, so the dashboard no longer offers it — no switcher, no pickers, no
 * labels. The `environment` column stays in the schema and every new row is
 * production, so nothing was migrated away and it could return one day.
 *
 * Callers still ask for "the active environment" rather than hard-coding the
 * value, so that decision lives in one place.
 */
export const DASHBOARD_ENVIRONMENT: Environment = "production";

export async function getActiveEnvironment(_userId: string): Promise<Environment> {
  return DASHBOARD_ENVIRONMENT;
}
