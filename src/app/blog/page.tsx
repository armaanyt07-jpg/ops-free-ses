import type { Metadata } from "next";
import Link from "next/link";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { MarketingMain, PageHeader } from "@/components/marketing/prose";
import { POSTS } from "@/lib/marketing/posts";
import { TOOLS } from "@/lib/marketing/tools";
import { getTenant } from "@/server/tenant";

export const metadata: Metadata = {
  title: "Blog — Ops-Free SES",
  description: "Practical guides to Amazon SES: cost, production access, bounces and complaints, and the free tools we built along the way.",
  alternates: { canonical: "/blog" },
};

export const dynamic = "force-dynamic";

export default async function BlogIndex() {
  const signedIn = Boolean(await getTenant());
  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <MarketingMain>
        <PageHeader kicker="Blog" title="Amazon SES, without the guesswork" lede="Plain guides to the parts of SES that cost people days." />

        <ul className="mt-10 divide-y border-y">
          {POSTS.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="hover:bg-muted/40 -mx-3 block rounded-lg px-3 py-5 transition-colors">
                <p className="font-semibold">{p.title}</p>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{p.description}</p>
                <p className="text-muted-foreground mt-2 text-xs">{p.readMinutes} min read</p>
              </Link>
            </li>
          ))}
        </ul>

        <h2 className="mt-16 text-xl font-semibold tracking-tight">Free tools</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {TOOLS.map((t) => (
            <li key={t.slug}>
              <Link href={`/tools/${t.slug}`} className="bg-card hover:border-primary/40 block h-full rounded-xl border p-4 transition-colors">
                <p className="text-sm font-semibold">{t.title}</p>
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{t.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </MarketingMain>
      <LandingFooter />
    </div>
  );
}
