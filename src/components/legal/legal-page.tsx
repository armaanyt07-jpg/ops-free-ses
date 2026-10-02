import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { LEGAL, unresolvedLegalFields } from "@/lib/legal/config";

/**
 * Shell for the Terms and Privacy pages. While any placeholder in
 * `src/lib/legal/config.ts` is unresolved it shows which ones, so a draft can't
 * pass as final.
 */
export function LegalPage({
  title,
  intro,
  sections,
  children,
}: {
  title: string;
  intro: string;
  /** Table of contents: [anchor id, heading]. */
  sections: Array<[string, string]>;
  children: React.ReactNode;
}) {
  const missing = unresolvedLegalFields();

  return (
    <div className="min-h-screen">
      <LandingNav />
      <main className="mx-auto max-w-3xl px-6 py-14 sm:py-20">
        {missing.length > 0 ? (
          <div
            role="note"
            className="mb-10 flex gap-3 rounded-xl border border-amber-600/30 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Draft: not yet final</p>
              <p className="mt-1">
                This page is a working draft and hasn&apos;t been reviewed. Details still to be filled in:{" "}
                {missing.join(", ")}.
              </p>
            </div>
          </div>
        ) : null}

        <p className="text-primary font-mono text-xs font-medium tracking-[0.15em] uppercase">Legal</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="text-muted-foreground mt-3 text-sm">Last updated {LEGAL.updated}</p>
        <p className="text-muted-foreground mt-6 text-base leading-relaxed">{intro}</p>

        <nav aria-label="Sections" className="bg-card mt-8 rounded-xl border p-4 text-sm">
          <ol className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {sections.map(([id, heading], i) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted-foreground hover:text-foreground transition-colors">
                  {i + 1}. {heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-12 space-y-12">{children}</div>

        <p className="text-muted-foreground mt-16 border-t pt-6 text-sm">
          See also our{" "}
          <Link href="/terms" className="text-foreground underline underline-offset-4">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-foreground underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}

export function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">
        {n}. {title}
      </h2>
      <div className="text-muted-foreground space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

export function B({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground font-medium">{children}</span>;
}
