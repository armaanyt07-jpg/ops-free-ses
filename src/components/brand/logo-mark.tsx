import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The brand mark: a continuous loop, standing for automated, always-on
 * delivery. Matches the "Horizontal logo" / navbar treatment from the brand
 * sheet — gradient glyph, no background badge.
 *
 * Used across the landing, auth and dashboard chrome, sometimes more than
 * once per page (desktop sidebar + mobile header), so the gradient id is
 * generated per instance rather than hard-coded.
 */
export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path
        d="M12 3a9 9 0 1 0 8.485 12"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="18.2" cy="7.6" r="2.1" fill={`url(#${gradientId})`} />
    </svg>
  );
}
