/** Blog posts, newest first. Feeds /blog, the sitemap and each post's header. */
export interface Post {
  slug: string;
  title: string;
  description: string;
  /** ISO date. */
  published: string;
  readMinutes: number;
}

export const POSTS: Post[] = [
  {
    slug: "resend-vs-amazon-ses-cost",
    title: "Resend vs Amazon SES: the real cost at 50k, 100k and 1M emails",
    description:
      "What sending email costs each month on Amazon SES and on Resend, with the arithmetic shown and the catch in each option.",
    published: "2026-10-06",
    readMinutes: 6,
  },
  {
    slug: "amazon-ses-sandbox-production-access",
    title: "Amazon SES sandbox: how to get production access",
    description:
      "What the sandbox limits, what the request form asks, why AWS says no, and how to write a request that gets approved.",
    published: "2026-10-06",
    readMinutes: 7,
  },
  {
    slug: "handle-ses-bounces-and-complaints",
    title: "How to handle Amazon SES bounces and complaints with SNS",
    description:
      "The full setup: configuration set, SNS topic, HTTPS subscription, signature checks and a suppression list, and what each step is for.",
    published: "2026-10-06",
    readMinutes: 9,
  },
];

export function postBySlug(slug: string): Post {
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) throw new Error(`Unknown post: ${slug}`);
  return post;
}
