import { ExternalLink } from "lucide-react";

import { CopyButton } from "@/components/dashboard/copy-button";
import { IAM_CREATE_USER_URL, IAM_POLICY } from "@/lib/aws/iam-policy";

/** The three console steps for an access key, with the policy to paste. */
export function IamSetup() {
  return (
    <ol className="text-muted-foreground list-decimal space-y-3 pl-5 text-sm marker:text-xs">
      <li>
        In the AWS console,{" "}
        <a
          href={IAM_CREATE_USER_URL}
          target="_blank"
          rel="noreferrer"
          className="text-foreground inline-flex items-center gap-1 font-medium underline underline-offset-4"
        >
          create an IAM user
          <ExternalLink className="size-3" aria-hidden />
        </a>{" "}
        (any name, no console access).
      </li>
      <li className="space-y-2">
        <span>
          Give it this policy: <em>Add permissions → Create inline policy → JSON</em>, paste,
          save.
        </span>
        <div className="relative">
          <pre className="max-h-48 overflow-auto rounded-lg bg-zinc-950 p-3 pr-20 font-mono text-[0.7rem] leading-relaxed text-zinc-200">
            {IAM_POLICY}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={IAM_POLICY} label="Copy" />
          </div>
        </div>
      </li>
      <li>
        Open the user → <em>Security credentials → Create access key</em> → &ldquo;Application
        running outside AWS&rdquo;. Paste the key below with the region you send from.
      </li>
    </ol>
  );
}
