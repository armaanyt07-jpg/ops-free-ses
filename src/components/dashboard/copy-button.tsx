"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Copies `text` to the clipboard. With `iconOnly`, `label` becomes the
 * accessible name (for tight spots such as DNS record rows).
 */
export function CopyButton({
  text,
  label,
  iconOnly = false,
}: {
  text: string;
  label: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={iconOnly ? "icon-sm" : "sm"}
      className={iconOnly ? "shrink-0" : undefined}
      aria-label={iconOnly ? (copied ? "Copied" : label) : undefined}
      title={iconOnly ? label : undefined}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  );
}
