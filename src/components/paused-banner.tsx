import { PauseCircle } from "lucide-react";

import { PAUSED_MESSAGE, SERVICE_PAUSED } from "@/lib/service-status";

/** Thin notice across the top of every page while the service is paused. */
export function PausedBanner() {
  if (!SERVICE_PAUSED) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <p className="mx-auto flex max-w-3xl items-start justify-center gap-2 sm:items-center">
        <PauseCircle className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden />
        <span>{PAUSED_MESSAGE}</span>
      </p>
    </div>
  );
}
