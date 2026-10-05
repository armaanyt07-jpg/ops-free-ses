import { Circle, CircleCheck } from "lucide-react";

import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import { cn } from "@/lib/utils";

/** Live reminder under a new-password field: each rule ticks as it is met. */
export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  return (
    <ul id={id} aria-label="Password requirements" className="space-y-1 text-xs">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        const Icon = met ? CircleCheck : Circle;
        return (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-1.5",
              met ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span>
              {rule.label}
              <span className="sr-only">{met ? " (done)" : " (missing)"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
