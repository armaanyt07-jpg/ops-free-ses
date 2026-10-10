import type { MetadataRoute } from "next";

import { LEGAL } from "@/lib/legal/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/"] }],
    sitemap: `https://${LEGAL.site}/sitemap.xml`,
  };
}
