"use client";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
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

import { Wordmark } from "@/components/brand/wordmark";

/**
 * Dashboard navigation — Phase 4 "responsive layouts". (The environment
 * switcher was removed in Phase 8: the dashboard has one environment.)
 *
 * ≥1024px: a fixed sidebar. Below that: a top bar whose menu opens a panel, so
 * nothing scrolls sideways on a phone. The active page is marked with
 * `aria-current`.
 */
type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
  exact?: boolean;
  /** Only shown once the account has sent something. */
  afterFirstSend?: boolean;
  /** Setup help: hidden once the account has sent something. */
  untilFirstSend?: boolean;
};
type NavGroup = {
  label: string | null;
  items: NavItem[];
  /** Collapsed by default; opens when one of its pages is active. */
  collapsible?: boolean;
  afterFirstSend?: boolean;
};

const GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/dashboard/activity", label: "Activity", icon: Activity, afterFirstSend: true },
      { href: "/dashboard/errors", label: "Problems", icon: AlertTriangle, afterFirstSend: true },
    ],
  },
  {
    label: "Sending",
    items: [
      { href: "/dashboard/domains", label: "Domains", icon: Globe },
      { href: "/dashboard/templates", label: "Templates", icon: FileCode2, afterFirstSend: true },
      {
        href: "/dashboard/suppressions",
        label: "Blocked addresses",
        icon: ShieldOff,
        afterFirstSend: true,
      },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
      { href: "/dashboard/aws", label: "AWS", icon: Cloud },
      { href: "/dashboard/sandbox", label: "Start sending to anyone", icon: Rocket },
      { href: "/guide", label: "Guide", icon: BookOpen, untilFirstSend: true },
    ],
  },
  {
    label: "Advanced",
    collapsible: true,
    afterFirstSend: true,
    items: [
      { href: "/dashboard/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/dashboard/health", label: "Sending status", icon: Gauge },
    ],
  },
];

/**
 * Progressive disclosure: setup help (`untilFirstSend`) goes away once the
 * account has sent, and day-to-day pages (`afterFirstSend`) appear. A page the
 * user is already on always stays visible.
 */
export function navItemVisible(
  item: Pick<NavItem, "afterFirstSend" | "untilFirstSend">,
  hasSent: boolean,
  active: boolean,
): boolean {
  return (hasSent ? !item.untilFirstSend : !item.afterFirstSend) || active;
}

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  hasSent,
  onNavigate,
}: {
  pathname: string;
  hasSent: boolean;
  onNavigate?: () => void;
}) {
  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href, item.exact);
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
  };

  // Before the first send, show only what setup needs. A page the user is
  // already on stays visible so the active marker never disappears.
  const visible = (item: NavItem) =>
    navItemVisible(item, hasSent, isActive(pathname, item.href, item.exact));

  return (
    <nav aria-label="Dashboard" className="space-y-5">
      {GROUPS.map((group) => {
        const items = group.items.filter(visible);
        if (!items.length || (group.afterFirstSend && !hasSent)) return null;
        const heading = group.label ? (
          <p className="text-muted-foreground px-3 text-xs font-medium tracking-wide uppercase">
            {group.label}
          </p>
        ) : null;
        if (group.collapsible) {
          const hasActive = items.some((i) => isActive(pathname, i.href, i.exact));
          return (
            <details key={group.label} open={hasActive} className="group space-y-1">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none px-3 text-xs font-medium tracking-wide uppercase">
                {group.label}
                <span aria-hidden className="ml-1 inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
              </summary>
              <div className="space-y-1 pt-1">{items.map(link)}</div>
            </details>
          );
        }
        return (
          <div key={group.label ?? "main"} className="space-y-1">
            {heading}
            {items.map(link)}
          </div>
        );
      })}
    </nav>
  );
}

function SignOut({ email }: { email: string }) {
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-muted-foreground truncate text-xs" title={email}>
        {email}
      </p>
      <div className="flex items-center justify-between">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </form>
        <ThemeToggle />
      </div>
    </div>
  );
}

export function AppNav({ email, hasSent }: { email: string; hasSent: boolean }) {
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
        <div className="flex-1">
          <NavLinks pathname={pathname} hasSent={hasSent} />
        </div>
        <SignOut email={email} />
      </aside>

      {/* Mobile / tablet top bar */}
      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          {brand}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="hover:bg-muted ml-auto grid size-9 place-items-center rounded-md"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open ? (
          <div id="mobile-nav" className="max-h-[calc(100dvh-3.5rem)] space-y-5 overflow-y-auto border-t px-4 py-4">
            <NavLinks pathname={pathname} hasSent={hasSent} onNavigate={() => setOpen(false)} />
            <SignOut email={email} />
          </div>
        ) : null}
      </header>
    </>
  );
}
