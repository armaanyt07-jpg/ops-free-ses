"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Cloud,
  FileCode2,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  Menu,
  Rocket,
  ShieldOff,
  Webhook,
  X,
} from "lucide-react";

import { switchEnvironment } from "@/app/dashboard/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { EnvironmentBadge } from "@/components/dashboard/primitives";
import type { Environment } from "@/db/schema";

/**
 * Dashboard navigation — Phase 4 "responsive layouts" and "environment
 * switching".
 *
 * ≥1024px: a fixed sidebar. Below that: a top bar whose menu opens a panel, so
 * nothing scrolls sideways on a phone. The active page is marked with
 * `aria-current`, and the environment is always visible — staging is tinted so
 * nobody mistakes it for production.
 */
const GROUPS = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/dashboard/activity", label: "Activity", icon: Activity },
      { href: "/dashboard/errors", label: "Errors", icon: AlertTriangle },
    ],
  },
  {
    label: "Sending",
    items: [
      { href: "/dashboard/templates", label: "Templates", icon: FileCode2 },
      { href: "/dashboard/domains", label: "Domains", icon: Globe },
      { href: "/dashboard/suppressions", label: "Suppressions", icon: ShieldOff },
      { href: "/dashboard/webhooks", label: "Webhooks", icon: Webhook },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
      { href: "/dashboard/aws", label: "AWS", icon: Cloud },
      { href: "/dashboard/sandbox", label: "Production access", icon: Rocket },
    ],
  },
  {
    label: "System",
    items: [{ href: "/dashboard/health", label: "Queue & health", icon: Gauge }],
  },
] as const;

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function EnvironmentSwitcher({ environment }: { environment: Environment }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={switchEnvironment} className="space-y-1">
      <label htmlFor="env-switcher" className="text-muted-foreground block text-xs font-medium">
        Environment
      </label>
      <div className="relative">
        <span
          aria-hidden
          className={`absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-full ${
            environment === "production" ? "bg-emerald-600" : "bg-amber-500"
          }`}
        />
        <select
          // Remounts whenever the server-resolved environment changes, so
          // this stays correct even when it wasn't this exact <select> that
          // triggered the change (e.g. the mobile switcher, or a stale
          // client-side render) — `defaultValue` alone only applies once, at
          // first mount, and silently ignores later prop updates.
          key={environment}
          id="env-switcher"
          name="environment"
          defaultValue={environment}
          onChange={() => formRef.current?.requestSubmit()}
          className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border pr-3 pl-7 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          <option value="production">Production</option>
          <option value="staging">Staging</option>
        </select>
      </div>
      <noscript>
        <button type="submit" className="text-xs underline">
          Switch
        </button>
      </noscript>
    </form>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Dashboard" className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.label ?? "main"} className="space-y-1">
          {group.label ? (
            <p className="text-muted-foreground px-3 text-xs font-medium tracking-wide uppercase">
              {group.label}
            </p>
          ) : null}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SignOut({ email }: { email: string }) {
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-muted-foreground truncate text-xs" title={email}>
        {email}
      </p>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

export function AppNav({ email, environment }: { email: string; environment: Environment }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on navigation and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const brand = (
    <Link href="/dashboard">
      <Wordmark />
    </Link>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="bg-muted/30 sticky top-0 hidden h-screen flex-col gap-6 overflow-y-auto border-r px-4 py-5 lg:flex">
        {brand}
        <EnvironmentSwitcher environment={environment} />
        <div className="flex-1">
          <NavLinks pathname={pathname} />
        </div>
        <SignOut email={email} />
      </aside>

      {/* Mobile / tablet top bar */}
      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          {brand}
          <span className="ml-auto">
            <EnvironmentBadge environment={environment} />
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="hover:bg-muted grid size-9 place-items-center rounded-md"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open ? (
          <div id="mobile-nav" className="max-h-[calc(100dvh-3.5rem)] space-y-5 overflow-y-auto border-t px-4 py-4">
            <EnvironmentSwitcher environment={environment} />
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            <SignOut email={email} />
          </div>
        ) : null}
      </header>
    </>
  );
}
