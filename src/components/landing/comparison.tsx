import { X } from "lucide-react";

import { SectionKicker } from "@/components/landing/section-kicker";

type Outcome = "removed" | "one-click" | "guided";

const OUTCOME_LABEL: Record<Outcome, string> = {
  removed: "Removed",
  "one-click": "One click",
  guided: "Guided",
};

const OUTCOME_CLASS: Record<Outcome, string> = {
  removed: "bg-primary text-primary-foreground border-transparent",
  "one-click": "bg-primary/10 text-primary border-primary/20",
  guided: "text-muted-foreground bg-card",
};

/**
 * One row per SES setup step, so each "raw" chore sits next to what is left
 * of it. Every claim here maps to shipped code; keep it that way.
 */
const STEPS: Array<{ step: string; raw: string[]; opsFree: string; outcome: Outcome }> = [
  {
    step: "AWS access",
    raw: ["Create an IAM user and write its policy", "Generate access keys", "Store them safely and rotate them"],
    opsFree: "Click Connect AWS and create the stack. It adds one scoped IAM role. There are no keys.",
    outcome: "one-click",
  },
  {
    step: "Domain verification",
    raw: ["Create the identity in SES", "Copy the DKIM records into your DNS", "Check back until it verifies"],
    opsFree: "Type your domain and add the three records shown, with copy buttons. On Route 53 they’re added for you.",
    outcome: "guided",
  },
  {
    step: "Delivery events",
    raw: [
      "Create an SNS topic",
      "Subscribe an HTTPS endpoint and confirm it",
      "Create a configuration set and its event destination",
    ],
    opsFree: "Nothing. Connecting AWS also creates the topic, the subscription and the configuration set in your account.",
    outcome: "removed",
  },
  {
    step: "Event handling",
    raw: ["Write a webhook that verifies SNS signatures", "Parse bounce, complaint and delivery events"],
    opsFree: "Nothing. Events are verified and recorded against each email.",
    outcome: "removed",
  },
  {
    step: "Suppression",
    raw: ["Store every bounced and complained address", "Check that list before each send"],
    opsFree: "Nothing. Those addresses are blocked automatically and checked before every send.",
    outcome: "removed",
  },
  {
    step: "Rate limits",
    raw: ["Look up your SES send rate", "Build a queue that paces sends to it", "Retry throttled and failed sends"],
    opsFree: "Nothing. Sends are queued, paced to your SES rate and retried with backoff.",
    outcome: "removed",
  },
  {
    step: "Send log",
    raw: ["Record every send and its outcome yourself", "Build somewhere to search it"],
    opsFree: "Nothing. Every email and what happened to it is in the dashboard.",
    outcome: "removed",
  },
  {
    step: "Production access",
    raw: ["Write the use-case description from scratch", "Submit it and hope it’s enough"],
    opsFree: "Answer a few questions. It drafts the request in the fields AWS asks for, and you submit it.",
    outcome: "guided",
  },
];

const REMOVED = STEPS.filter((s) => s.outcome === "removed").length;

function OutcomeTag({ outcome }: { outcome: Outcome }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[0.65rem] font-medium whitespace-nowrap ${OUTCOME_CLASS[outcome]}`}
    >
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

export function Comparison() {
  return (
    <section id="before-after" className="bg-muted/30 border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="02" label="Before / after" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
            {STEPS.length} setup steps.
            <br />
            {REMOVED} of them are gone.
          </h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            Ops-Free still sends through your own SES account. This is every
            step of setting SES up properly, and what&apos;s left of it for you.
          </p>
        </div>

        <div className="bg-card mt-14 overflow-hidden rounded-2xl border shadow-sm">
          <div className="text-muted-foreground hidden grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1fr)] border-b text-xs font-medium tracking-[0.12em] uppercase md:grid">
            <p className="px-6 py-4">Step</p>
            <p className="border-l px-6 py-4">Raw SES: you do</p>
            <p className="bg-primary/[0.04] text-primary border-l px-6 py-4">With Ops-Free: you do</p>
          </div>

          <ol>
            {STEPS.map((s, i) => (
              <li
                key={s.step}
                className="grid grid-cols-1 border-b last:border-b-0 md:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1fr)]"
              >
                <div className="flex items-center justify-between gap-3 px-6 pt-5 md:items-start md:justify-start md:py-5">
                  <p className="flex items-baseline gap-3 text-sm font-medium">
                    <span className="text-muted-foreground/50 font-mono text-xs tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {s.step}
                  </p>
                  <span className="md:hidden">
                    <OutcomeTag outcome={s.outcome} />
                  </span>
                </div>

                <div className="px-6 pt-3 pb-4 md:border-l md:py-5">
                  <p className="text-muted-foreground/70 mb-2 text-[0.65rem] font-medium tracking-[0.12em] uppercase md:hidden">
                    Raw SES
                  </p>
                  <ul className="space-y-1.5">
                    {s.raw.map((chore) => (
                      <li key={chore} className="text-muted-foreground flex gap-2.5 text-sm leading-snug">
                        <X className="text-muted-foreground/50 mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {chore}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-primary/[0.04] px-6 pt-4 pb-5 md:border-l md:py-5">
                  <p className="text-primary mb-2 text-[0.65rem] font-medium tracking-[0.12em] uppercase md:hidden">
                    With Ops-Free
                  </p>
                  <div className="flex flex-col items-start gap-2">
                    <span className="hidden md:inline-flex">
                      <OutcomeTag outcome={s.outcome} />
                    </span>
                    <p className="text-sm leading-snug">{s.opsFree}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-muted-foreground mt-6 max-w-3xl text-sm leading-relaxed">
          <span className="text-foreground font-medium">Still yours:</span> the AWS bill for what you send,
          your domain&apos;s DNS records (unless it&apos;s on Route 53), and AWS&apos;s review of your
          production-access request.
        </p>
      </div>
    </section>
  );
}
