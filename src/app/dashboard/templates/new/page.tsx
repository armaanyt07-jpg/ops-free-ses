import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/primitives";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

/** A working starter, so a new template shows a real preview immediately. */
const STARTER = {
  name: "",
  subject: "Welcome to {{product}}, {{first_name}}",
  html: `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;">
    <h1 style="font-size:20px;margin:0 0 16px;">Hi {{first_name}},</h1>
    <p style="line-height:1.5;">Thanks for signing up for {{product}}. Confirm your address to get started:</p>
    <p><a href="{{confirm_url}}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">Confirm email</a></p>
    <p style="color:#666;font-size:12px;">If you didn't sign up, you can ignore this email.</p>
  </body>
</html>`,
  text: "",
  variables: [
    { name: "first_name", required: true, sample: "Alice" },
    { name: "product", required: false, defaultValue: "our app", sample: "Acme" },
    { name: "confirm_url", required: true, sample: "https://example.com/confirm/abc123" },
  ],
};

export default async function NewTemplatePage() {
  await requireTenant();
  return (
    <div className="space-y-6">
      <Link href="/dashboard/templates" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" aria-hidden /> Templates
      </Link>
      <PageHeader title="New template" description="Starts from an example — replace it with your own. Saving creates version 1." />
      <TemplateEditor initial={STARTER} />
    </div>
  );
}
