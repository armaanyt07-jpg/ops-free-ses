import { REQUIRED, type Draft, type PlatformFacts } from "@/lib/sandbox/request";

/**
 * "Before you submit" — Phase 9. Advisory only.
 *
 * AWS decides production access, and its Support team does not publish its
 * criteria, so this never says an item guarantees or blocks anything. Each item
 * is either `ok` (true now, from what the platform knows or the user wrote) or
 * `consider` (something worth a look first). There is no `fail`, and nothing
 * here gates the review step.
 *
 * What it can rest on:
 *   - AWS's own request guide (docs.aws.amazon.com/ses/latest/dg/
 *     request-production-access.html): the request asks for a website URL and
 *     the mail type; the sender acknowledges they only send to people who asked
 *     to hear from them and have a process for bounces and complaints; and
 *     "verifying your domain with SES before requesting production access is a
 *     best practice that helps to get your production access request approved
 *     faster". It does not say a domain is required, and neither does this.
 *   - Facts the platform measures (verified identities, authentication results,
 *     events received, a send made), and the user's own answers.
 *
 * Pure, so the page and the tests see the same result.
 */
export interface ReadinessItem {
  id: string;
  label: string;
  status: "ok" | "consider";
  detail: string;
  /** Where to act on a `consider`, when there is somewhere to go. */
  href?: string;
}

export interface ReadinessInput {
  draft: Draft;
  facts: PlatformFacts;
  /** This environment has sent at least one email through the platform. */
  hasSent: boolean;
}

const DESCRIPTION_COMFORTABLE = 200;

export function readinessItems({ draft, facts, hasSent }: ReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const domains = facts.domains;
  const addresses = facts.verifiedAddresses ?? 0;

  // 1. A sender AWS can see is yours.
  if (domains.length > 0) {
    items.push({
      id: "sender",
      label: "A verified domain",
      status: "ok",
      detail: `${domains.map((d) => d.domain).join(", ")} is verified in SES. AWS's guide calls verifying a domain first a best practice that helps a request along.`,
    });
  } else if (addresses > 0) {
    items.push({
      id: "sender",
      label: "A verified sender address",
      status: "ok",
      detail:
        "You're sending as a verified address, which works and doesn't need a domain. If you have a domain, AWS's guide says verifying it first is a best practice that helps a request along.",
      href: "/dashboard/domains",
    });
  } else {
    items.push({
      id: "sender",
      label: "Verify where your emails come from",
      status: "consider",
      detail: "No verified domain or address yet. Verify one first: a domain, or just your email address.",
      href: "/dashboard/domains",
    });
  }

  // 2. Authentication on the domains the user has.
  if (domains.length > 0) {
    const weak = domains.filter((d) => d.dkim !== "pass" || d.spf !== "pass" || d.dmarc !== "pass");
    items.push(
      weak.length === 0
        ? {
            id: "authentication",
            label: "Domain authentication",
            status: "ok",
            detail: "DKIM, SPF and DMARC pass on your verified domains at the last check.",
          }
        : {
            id: "authentication",
            label: "Domain authentication",
            status: "consider",
            detail: `Not every check passes on ${weak.map((d) => d.domain).join(", ")} (DKIM ${weak[0]!.dkim}, SPF ${weak[0]!.spf}, DMARC ${weak[0]!.dmarc}). Re-check the domain after fixing its DNS records.`,
            href: "/dashboard/domains",
          },
    );
  }

  // 3. Bounce and complaint handling, which the AWS form asks you to confirm.
  items.push(
    facts.autoSuppressionActive
      ? {
          id: "events",
          label: "Bounces and complaints are tracked",
          status: "ok",
          detail:
            "SES events are connected and arriving, so bounced and complained addresses are recorded and blocked automatically. You can describe that truthfully.",
        }
      : {
          id: "events",
          label: "Connect delivery events",
          status: "consider",
          detail:
            "AWS asks you to confirm you have a process for bounces and complaints. Connecting events makes that process automatic here; otherwise describe your own process honestly.",
          href: "/dashboard/webhooks",
        },
  );

  // 4. A working integration.
  items.push(
    hasSent
      ? { id: "sent", label: "You've sent a test email", status: "ok", detail: "Sending works end to end from your account." }
      : {
          id: "sent",
          label: "Send a test email",
          status: "consider",
          detail: "You haven't sent anything yet. Send a test first, so you know sending works before you apply.",
          href: "/dashboard",
        },
  );

  // 5. The website URL the form asks for.
  const websiteOk = REQUIRED.find((r) => r.key === "websiteUrl")!.check(draft);
  items.push(
    websiteOk
      ? {
          id: "website",
          label: "A website URL",
          status: "ok",
          detail: "AWS asks for a URL so it can see what you do. Make sure it loads publicly and says what your product is.",
        }
      : {
          id: "website",
          label: "Add your website URL",
          status: "consider",
          detail: "AWS's form asks for a website that shows the kind of content you plan to send.",
          href: "/dashboard/sandbox#questionnaire",
        },
  );

  // 6. A description specific enough to understand.
  const length = draft.useCase?.length ?? 0;
  items.push(
    length >= DESCRIPTION_COMFORTABLE
      ? {
          id: "use-case",
          label: "A specific use-case description",
          status: "ok",
          detail: "Your description has room to say what the product is and who gets the email.",
        }
      : {
          id: "use-case",
          label: "Say more about your use case",
          status: "consider",
          detail:
            "A short description gives AWS little to go on. Say what your product is, who the recipients are, and what triggers each email. Only write what's true.",
          href: "/dashboard/sandbox#questionnaire",
        },
  );

  // 7. Permission. AWS's form has the sender acknowledge this explicitly.
  if (draft.acquisitionMethods?.includes("purchased")) {
    items.push({
      id: "permission",
      label: "Where your recipients come from",
      status: "consider",
      detail:
        "You selected purchased, rented or third-party lists. AWS's form asks you to confirm you only email people who've explicitly requested it, so check that this is accurate.",
      href: "/dashboard/sandbox#questionnaire",
    });
  }

  return items;
}

export function readinessSummary(items: ReadinessItem[]): { ok: number; consider: number } {
  return {
    ok: items.filter((i) => i.status === "ok").length,
    consider: items.filter((i) => i.status === "consider").length,
  };
}
