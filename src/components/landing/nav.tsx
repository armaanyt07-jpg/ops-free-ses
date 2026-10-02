"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, LayoutDashboard, Layers, ListChecks, Menu, Users, Workflow, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavDropdown, type NavDropdownItem } from "@/components/landing/nav-dropdown";
import { NavMobileAccordion } from "@/components/landing/nav-mobile-accordion";
import { Wordmark } from "@/components/brand/wordmark";

const PRODUCT_ITEMS: NavDropdownItem[] = [
  { href: "/#problem", label: "Why Ops-Free", description: "The problem with raw SES", icon: Layers },
  { href: "/#how-it-works", label: "How it works", description: "Architecture overview", icon: Workflow },
  { href: "/#get-started", label: "Get started", description: "Steps to send your first email", icon: ListChecks },
  { href: "/#dashboard", label: "Dashboard", description: "Product preview", icon: LayoutDashboard },
  { href: "/#audience", label: "Who it's for", description: "Teams and developers Ops-Free fits", icon: Users },
];

/**
 * Shared by the landing page and /guide, so section links are absolute ("/#api")
 * and work from either. `signedIn` swaps the sign-in buttons for a dashboard link.
 */
export function LandingNav({ signedIn = false }: { signedIn?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile panel on Escape, matching the desktop dropdown.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
        <Link href="/">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 text-sm sm:flex">
          <NavDropdown label="Product" items={PRODUCT_ITEMS} />
          <Link
            href="/#api"
            className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-3 py-2 transition-colors"
          >
            API
          </Link>
          <Link
            href="/guide"
            className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-3 py-2 transition-colors"
          >
            Guide
          </Link>
        </nav>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Start Building</Link>
              </Button>
            </>
          )}
        </div>

        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-panel"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen((o) => !o)}
          className="hover:bg-muted ml-auto grid size-9 place-items-center rounded-md sm:hidden"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile panel — tap-to-expand, no hover; same grid-rows height
          animation as the Product accordion below it. */}
      <div
        id="mobile-nav-panel"
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out sm:hidden",
          mobileOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 border-t px-4 py-3">
            <NavMobileAccordion label="Product" items={PRODUCT_ITEMS} onNavigate={closeMobile} />
            <Link
              href="/#api"
              onClick={closeMobile}
              className="hover:bg-muted block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            >
              API
            </Link>
            <Link
              href="/guide"
              onClick={closeMobile}
              className="hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            >
              <BookOpen className="size-4" aria-hidden />
              Guide
            </Link>
            <div className="flex flex-col gap-2 border-t pt-3">
              {signedIn ? (
                <Button asChild size="sm" className="w-full">
                  <Link href="/dashboard" onClick={closeMobile}>
                    Dashboard
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link href="/login" onClick={closeMobile}>
                      Sign in
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="w-full">
                    <Link href="/signup" onClick={closeMobile}>
                      Start Building
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
