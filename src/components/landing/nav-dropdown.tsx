"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface NavDropdownItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Desktop nav dropdown: hover-to-open with a short close delay (so a tiny
 * cursor gap crossing from trigger to panel doesn't close it), click to
 * toggle, click-outside and Escape to close, and a compact popover with a
 * fade + slight downward/scale entrance. Hidden below `sm` — mobile uses
 * `NavMobileAccordion` instead, which doesn't rely on hover.
 */
export function NavDropdown({ label, items }: { label: string; items: NavDropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const closeNow = () => {
    clearCloseTimer();
    setOpen(false);
  };

  useEffect(() => clearCloseTimer, []);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) closeNow();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeNow();
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => {
        clearCloseTimer();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) closeNow();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => {
              panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
            });
          }
        }}
        className="text-muted-foreground hover:text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm transition-colors"
      >
        {label}
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-200 ease-out", open && "rotate-180")}
          aria-hidden
        />
      </button>

      <div
        id={panelId}
        ref={panelRef}
        inert={!open}
        className={cn(
          "absolute top-full left-0 z-40 w-72 origin-top pt-2 transition-all duration-200 ease-out",
          open
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none -translate-y-1 scale-95 opacity-0",
        )}
      >
        <div className="bg-popover text-popover-foreground rounded-xl border p-1.5 shadow-lg ring-1 ring-black/[0.03]">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeNow}
              className="hover:bg-muted flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
            >
              <span className="bg-primary/10 text-primary mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">
                <item.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{item.label}</span>
                <span className="text-muted-foreground block text-xs leading-snug">
                  {item.description}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
