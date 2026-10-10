import type { Metadata } from "next";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { A, B, Code, H2, MarketingMain, PageHeader, Prose, SkipItCta, UL } from "@/components/marketing/prose";
import { DnsChecker } from "@/components/tools/dns-checker";
import { getTenant } from "@/server/tenant";

export const metadata: Metadata = {
  title: "Amazon SES DNS checker (SPF, DKIM, DMARC) — Ops-Free",
  description:
    "Free tool: check your domain's SPF, DMARC and Amazon SES DKIM records, see exactly what's wrong and how to fix it. No sign-up.",
  alternates: { canonical: "/tools/ses-dns-checker" },
};

export const dynamic = "force-dynamic";

export default async function DnsCheckerPage() {
  const signedIn = Boolean(await getTenant());
  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <MarketingMain>
        <PageHeader
          kicker="Free tool"
          title="Amazon SES DNS checker"
          lede="Type your domain to check the three records that decide whether SES mail lands in the inbox: DKIM, SPF and DMARC. You get a plain answer and the exact fix. No sign-up."
        />
        <DnsChecker />

        <Prose>
          <H2 id="what">What each record does</H2>
          <UL>
            <li>
              <B>DKIM</B> signs every message so receivers can tell it really came from your domain. SES gives each
              domain three DKIM CNAME records, and the identity isn&apos;t verified until all three are published.
            </li>
            <li>
              <B>SPF</B> lists the servers allowed to send for your domain. A domain may have only one SPF record:
              two of them is a permanent error, and SPF then fails for every message.
            </li>
            <li>
              <B>DMARC</B> tells receivers what to do when a message fails those checks. Start with{" "}
              <Code>p=none</Code> to monitor, then move to <Code>quarantine</Code> or <Code>reject</Code>.
            </li>
          </UL>

          <H2 id="mistakes">The mistakes we see most</H2>
          <UL>
            <li>
              <B>The domain typed twice.</B> Many DNS providers add your domain to whatever you type as the name, so
              pasting the full name creates <Code>abc._domainkey.example.com.example.com</Code>. The checker spots this
              and tells you.
            </li>
            <li>
              <B>Two SPF records</B>, usually one from the email host and a new one for SES. Merge them into one.
            </li>
            <li>
              <B>A free hosting subdomain</B> such as <Code>myapp.vercel.app</Code>. You can&apos;t add DNS records there,
              so SES can never verify it. Use a domain you own.
            </li>
          </UL>
          <p>
            Still stuck on getting out of the sandbox? Use the{" "}
            <A href="/tools/ses-production-access">production access request writer</A>.
          </p>
        </Prose>

        <SkipItCta title="Let Ops-Free keep these right">
          Ops-Free checks your DNS records for you, explains anything that&apos;s wrong in plain words, and on
          Route 53 adds the DKIM records itself. It also sets up bounce and complaint handling in one click.
        </SkipItCta>
      </MarketingMain>
      <LandingFooter />
    </div>
  );
}
