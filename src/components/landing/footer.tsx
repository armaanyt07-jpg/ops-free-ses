import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Why Ops-Free", href: "/#problem" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "API", href: "/#api" },
      { label: "Pricing", href: "/pricing" },
      { label: "Guide", href: "/guide" },
      { label: "Dashboard", href: "/#dashboard" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Start Building", href: "/signup" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="bg-background border-t">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <Wordmark />
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              A developer email API and operations layer, built on Amazon SES
              and your own AWS account.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 sm:gap-16">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-xs font-semibold tracking-wide uppercase">{col.title}</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="text-muted-foreground hover:text-foreground transition-colors">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="text-muted-foreground mt-12 flex flex-col gap-2 border-t pt-6 text-sm font-medium sm:flex-row sm:items-center sm:justify-between">
          <p>Ops-Free SES — not affiliated with Amazon Web Services.</p>
          <p>Built on Amazon SES.</p>
        </div>
      </div>
    </footer>
  );
}
