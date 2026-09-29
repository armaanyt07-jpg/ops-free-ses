"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavDropdownItem } from "@/components/landing/nav-dropdown";

/**
 * Mobile equivalent of `NavDropdown`: tap to expand/collapse, no hover.
 * The height animation uses the CSS grid `0fr` → `1fr` technique (a
 * `grid-template-rows` transition around an `overflow-hidden` child), so it
 * animates smoothly to the content's natural height without measuring it in
 * JS or pulling in an animation library.
 */
export function NavMobileAccordion({
  label,
  items,
  onNavigate,
}: {
  label: string;
  items: NavDropdownItem[];
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
      >
        {label}
        <ChevronDown
          className={cn(
            "text-muted-foreground size-4 transition-transform duration-200 ease-out",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 py-1 pl-2">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
