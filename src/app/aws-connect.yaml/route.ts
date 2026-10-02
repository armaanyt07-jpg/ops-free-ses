import { buildConnectTemplate } from "@/lib/aws/connect-template";

/**
 * The CloudFormation template for one-click "Connect AWS", served as-is so a
 * customer can read exactly what the stack will create before pressing Create.
 * (The same text is what `npm run aws:publish-template` uploads to S3, which is
 * where AWS's console link requires it to live.)
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildConnectTemplate(), {
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
