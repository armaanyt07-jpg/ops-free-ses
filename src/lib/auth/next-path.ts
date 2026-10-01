/**
 * Where to send the user after an auth link. Only same-site paths are
 * accepted: `next` arrives in a URL anyone can craft, and an absolute or
 * protocol-relative value (`//evil.example`) would make this app an open
 * redirect.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
