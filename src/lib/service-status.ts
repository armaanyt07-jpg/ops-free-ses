/**
 * Paused mode.
 *
 * While true, the hosted service is switched off: the database (Supabase),
 * Redis (Upstash) and the worker (Railway) may be paused or gone. The public
 * pages stay up as a demo, with a notice; sign-in, the dashboard and the API
 * are turned off so nobody hits a half-working product.
 *
 * Nothing on a public page touches Supabase while this is true, so a paused
 * project cannot slow down or break the landing page.
 *
 * To resume: bring those services back, then set this to false and deploy.
 */
export const SERVICE_PAUSED = true;

export const PAUSED_MESSAGE =
  "Ops-Free is paused for now. You can look around and use the free tools, but sign-in and sending are turned off.";
