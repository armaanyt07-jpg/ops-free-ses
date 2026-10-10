/** The free public tools, in the order /tools lists them. Also feeds the sitemap. */
export interface Tool {
  slug: string;
  title: string;
  description: string;
}

export const TOOLS: Tool[] = [
  {
    slug: "ses-dns-checker",
    title: "Amazon SES DNS checker",
    description:
      "Check a domain's SPF, DMARC and SES DKIM records, see exactly what's wrong and how to fix it. No sign-up.",
  },
  {
    slug: "ses-production-access",
    title: "SES production access request writer",
    description:
      "Answer a few questions and get a clear, honest request to move your Amazon SES account out of the sandbox.",
  },
  {
    slug: "ses-cost-calculator",
    title: "Email API cost calculator",
    description: "What sending really costs each month: Amazon SES with Ops-Free, compared with Resend, at any volume.",
  },
];
