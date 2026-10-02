import type { SesAccountSnapshot } from "@/lib/ses/client";

/**
 * Where an account stands on SES production access — Phase 9.
 *
 * Turns AWS's own snapshot into one state and the words to go with it, so the
 * Overview, AWS page and sandbox page all say the same thing. Pure.
 *
 * It keeps Phase 6's rule (SRS §13): this platform never states or predicts an
 * approval. The only outcome ever shown is what AWS reported, and the one
 * timing statement ("initial response within 24 hours, longer if more
 * information is needed") is attributed to AWS, from its documentation
 * (docs.aws.amazon.com/ses/latest/dg/request-production-access.html). Nothing
 * here says approval is likely, soon or certain; `access-state.test.ts` fails
 * if that kind of wording appears.
 */
export type AccessState =
  | "not_connected"
  | "unknown"
  | "not_requested"
  | "pending"
  | "syncing"
  | "denied"
  | "failed"
  | "granted";

export type AccessTone = "neutral" | "waiting" | "success" | "problem";

export interface AccessView {
  state: AccessState;
  tone: AccessTone;
  title: string;
  summary: string;
  /** What the user can usefully do while in the sandbox; empty once granted. */
  canDoNow: string[];
  next: { label: string; href: string } | null;
  /** AWS Support case id, when AWS reported one. */
  caseId: string | null;
}

/** The documented SES sandbox limits, used only when the snapshot has none. */
const SANDBOX_DAILY = 200;
const SANDBOX_RATE = 1;

export function accessState(account: SesAccountSnapshot | null, connected: boolean): AccessState {
  if (!connected) return "not_connected";
  if (!account) return "unknown";
  if (account.productionAccessEnabled) return "granted";
  switch (account.reviewStatus) {
    case "PENDING":
      return "pending";
    case "DENIED":
      return "denied";
    case "FAILED":
      return "failed";
    // AWS records a grant but the account still reports sandbox limits.
    case "GRANTED":
      return "syncing";
    default:
      return "not_requested";
  }
}

function sandboxChecklist(account: SesAccountSnapshot | null): string[] {
  const daily = account?.max24HourSend ?? SANDBOX_DAILY;
  const rate = account?.maxSendRate ?? SANDBOX_RATE;
  return [
    "Build and test your whole integration. Everything works except sending to people you haven't verified.",
    `Send up to ${daily.toLocaleString("en-US")} emails a day, ${rate} a second, to addresses you've verified in SES. Verify your own and your team's addresses.`,
    "Use success@, bounce@ and complaint@simulator.amazonses.com to see delivered, bounced and complained emails in Activity.",
  ];
}

export function describeAccess(
  account: SesAccountSnapshot | null,
  opts: { connected: boolean; /** A request was prepared and reviewed here. */ prepared?: boolean },
): AccessView {
  const state = accessState(account, opts.connected);
  const caseId = account?.reviewCaseId ?? null;
  const base = { state, caseId, canDoNow: [] as string[], next: null as AccessView["next"] };

  switch (state) {
    case "not_connected":
      return {
        ...base,
        tone: "neutral",
        title: "Connect your AWS account",
        summary: "Connect AWS to see your sending limits and whether your account can send to anyone.",
        next: { label: "Connect AWS", href: "/dashboard/aws" },
      };

    case "unknown":
      return {
        ...base,
        tone: "neutral",
        title: "We haven't checked your AWS account yet",
        summary: "Re-check to see whether it's still in the SES sandbox.",
        next: { label: "Check now", href: "/dashboard/sandbox" },
      };

    case "not_requested":
      return {
        ...base,
        tone: "neutral",
        title: "Your account is in the SES sandbox",
        summary: opts.prepared
          ? "You can currently send only to addresses you've verified in SES, and to Amazon's mailbox simulator. You've prepared a request, but AWS doesn't show one yet. Submit it in the AWS console to ask for production access."
          : "You can currently send only to addresses you've verified in SES, and to Amazon's mailbox simulator. To email anyone, ask AWS for production access.",
        canDoNow: sandboxChecklist(account),
        next: opts.prepared
          ? { label: "Open your prepared request", href: "/dashboard/sandbox#request" }
          : { label: "Start sending to anyone", href: "/dashboard/sandbox" },
      };

    case "pending":
      return {
        ...base,
        tone: "waiting",
        title: "Waiting for AWS",
        summary:
          "AWS has your production-access request. AWS says its Support team gives an initial response within 24 hours, and that it can take longer if it needs more information from you. AWS doesn't let you edit the request while it's under review, and nothing here can speed it up or tell you the outcome in advance.",
        canDoNow: sandboxChecklist(account),
        next: { label: "Re-check status", href: "/dashboard/sandbox" },
      };

    case "syncing":
      return {
        ...base,
        tone: "waiting",
        title: "AWS reports a grant; your limits haven't updated yet",
        summary:
          "AWS shows the latest request as granted, but the account still reports sandbox limits. Re-check in a few minutes.",
        canDoNow: sandboxChecklist(account),
        next: { label: "Re-check status", href: "/dashboard/sandbox" },
      };

    case "denied":
      return {
        ...base,
        tone: "problem",
        title: "AWS didn't grant production access",
        summary:
          "AWS denied the request, and it may not give a detailed reason. You can reply on the support case with more detail about your use case, how recipients opt in, and how you handle bounces and complaints. Your answers here are saved, so you can improve them.",
        canDoNow: sandboxChecklist(account),
        next: { label: "Review your answers", href: "/dashboard/sandbox#questionnaire" },
      };

    case "failed":
      return {
        ...base,
        tone: "problem",
        title: "AWS couldn't process the request",
        summary: "AWS reported an internal error receiving the request. It can be submitted again.",
        canDoNow: sandboxChecklist(account),
        next: { label: "Prepare it again", href: "/dashboard/sandbox#request" },
      };

    case "granted":
      return {
        ...base,
        tone: "success",
        title: "Production access is on",
        summary:
          "AWS reports this account can send to any recipient. Every address or domain you send from still has to be verified.",
      };
  }
}

/** True for the states where the user is still limited by the sandbox. */
export function inSandbox(state: AccessState): boolean {
  return state === "not_requested" || state === "pending" || state === "syncing" || state === "denied" || state === "failed";
}
