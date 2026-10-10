import type { MetadataRoute } from "next";

import { LEGAL } from "@/lib/legal/config";
import { POSTS } from "@/lib/marketing/posts";
import { TOOLS } from "@/lib/marketing/tools";

const origin = `https://${LEGAL.site}`;

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/guide", "/security", "/blog", "/terms", "/privacy"].map((path) => ({
    url: `${origin}${path}`,
  }));
  return [
    ...pages,
    ...TOOLS.map((t) => ({ url: `${origin}/tools/${t.slug}` })),
    ...POSTS.map((p) => ({ url: `${origin}/blog/${p.slug}`, lastModified: p.published })),
  ];
}
