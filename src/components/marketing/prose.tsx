import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Building blocks for the public tools and blog: the same type scale and
 * colours as /security, so every long-form page reads as one site.
 */

export function PageHeader({
  kicker,
  title,
  lede,
  meta,
}: {
  kicker: string;
  title: string;
  lede?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header>
      <p className="text-primary font-mono text-xs font-medium tracking-[0.15em] uppercase">{kicker}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
      {meta ? <p className="text-muted-foreground mt-3 text-sm">{meta}</p> : null}
      {lede ? <p className="text-muted-foreground mt-5 text-base leading-relaxed">{lede}</p> : null}
    </header>
  );
}

export function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-foreground scroll-mt-24 pt-4 text-xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-foreground pt-2 text-base font-semibold">{children}</h3>;
}

/** Wraps an article body: spacing and muted body text, with headings in full colour. */
export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground mt-10 space-y-4 text-[0.95rem] leading-relaxed">{children}</div>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

export function OL({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
}

export function B({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground font-medium">{children}</span>;
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[0.8rem] [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:\/\//.test(href);
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
      {children}
    </a>
  ) : (
    <Link href={href} className="text-foreground underline underline-offset-4">
      {children}
    </Link>
  );
}

export function Callout({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-muted/40 rounded-xl border px-5 py-4 text-sm leading-relaxed", className)}>
      {title ? <p className="text-foreground font-semibold">{title}</p> : null}
      <div className={cn("text-muted-foreground space-y-2", title && "mt-1.5")}>{children}</div>
    </div>
  );
}

/** The "skip all this" box that ends every tool and post. */
export function SkipItCta({
  title = "Skip all of this",
  children = "Ops-Free connects your AWS account in one click and sets up SNS, the configuration set, bounce and complaint handling and suppression for you. Your mail still sends from your own SES account, at Amazon's price.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <aside className="border-primary/30 bg-primary/5 mt-14 rounded-2xl border p-6 sm:p-7">
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{children}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/signup">
            Start free
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/guide">Read the guide</Link>
        </Button>
      </div>
    </aside>
  );
}

export function MarketingMain({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <main className={cn("mx-auto px-6 py-14 sm:py-20", wide ? "max-w-5xl" : "max-w-3xl")}>{children}</main>;
}
