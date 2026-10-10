import Link from "next/link";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { MarketingMain, PageHeader, Prose, SkipItCta } from "@/components/marketing/prose";
import { postBySlug } from "@/lib/marketing/posts";
import { getTenant } from "@/server/tenant";

/** One layout for every post: nav, header with date and read time, body, then the call to action. */
export async function Article({
  slug,
  lede,
  cta,
  children,
}: {
  slug: string;
  lede: string;
  cta?: React.ReactNode;
  children: React.ReactNode;
}) {
  const post = postBySlug(slug);
  const signedIn = Boolean(await getTenant());
  const date = new Date(`${post.published}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <MarketingMain>
        <p className="mb-6 text-sm">
          <Link href="/blog" className="text-muted-foreground hover:text-foreground transition-colors">
            ← All posts
          </Link>
        </p>
        <PageHeader kicker="Blog" title={post.title} meta={`${date} · ${post.readMinutes} min read`} lede={lede} />
        <Prose>{children}</Prose>
        <SkipItCta>{cta}</SkipItCta>
      </MarketingMain>
      <LandingFooter />
    </div>
  );
}
