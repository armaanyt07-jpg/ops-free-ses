import Link from "next/link";
import { ExternalLink, FileWarning, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Fields, PageHeader, Time } from "@/components/dashboard/primitives";
import { RevalidateButton } from "@/components/dashboard/revalidate-button";
import { SandboxQuestionnaire } from "@/components/dashboard/sandbox-questionnaire";
import { CopyButton, ReviewForm } from "@/components/dashboard/sandbox-review";
import { formatDateTime } from "@/lib/dashboard/format";
import { listCredentials } from "@/server/credentials";
import { getActiveEnvironment } from "@/server/environment";
import { buildRequest, collectFacts, getSandboxRequest, isReviewed, readDraft } from "@/server/sandbox";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** AWS's own words for its review states. Shown verbatim, never inferred. */
const REVIEW_LABEL: Record<string, string> = {
  PENDING: "AWS has received a request and is reviewing it.",
  GRANTED: "AWS has granted production access.",
  DENIED: "AWS has denied the request.",
  FAILED: "AWS reports an internal error receiving the request; it can be submitted again.",
};

/**
 * AWS sandbox-exit assistant — SRS §13, Phase 6.
 *
 * Questionnaire → generated request (a draft, with the source of every
 * statement) → human review → copy into AWS. The platform never submits and
 * never states or predicts an outcome; the only status shown is AWS's own,
 * labelled as such, from the last time AWS was asked.
 */
export default async function SandboxPage() {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);

  const [credentials, row, facts, built] = await Promise.all([
    listCredentials(tenant.id),
    getSandboxRequest(tenant.id, environment),
    collectFacts(tenant.id, environment),
    buildRequest(tenant.id, environment),
  ]);

  const credential = credentials.find((c) => c.environment === environment);
  const account = credential?.account ?? null;
  const draft = readDraft(row);
  const reviewed = built.ok && isReviewed(row, built.hash);
  const region = built.ok ? built.request.region : (draft.region ?? credential?.awsRegion ?? "");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Production access"
        description={
          <>
            Prepare the request that takes your SES account out of the sandbox, for{" "}
            <strong className="text-foreground">{environment}</strong>. You answer; the assistant
            only arranges your answers. You review, then submit it in AWS yourself.
          </>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Status reported by AWS</CardTitle>
              <CardDescription>
                {credential?.lastValidatedAt ? (
                  <>
                    As of the last check with AWS, <Time date={credential.lastValidatedAt} />. This page never
                    guesses a status.
                  </>
                ) : (
                  "Not checked with AWS yet."
                )}
              </CardDescription>
            </div>
            {credential?.active ? <RevalidateButton environment={environment} /> : null}
          </div>
        </CardHeader>
        <CardContent>
          {!credential ? (
            <p className="text-sm">
              No AWS credential for {environment}.{" "}
              <Link href="/dashboard/aws" className="underline underline-offset-4">
                Add one
              </Link>{" "}
              to see sandbox and review status.
            </p>
          ) : (
            <Fields
              items={[
                ["Region", credential.awsRegion],
                [
                  "Sandbox",
                  account ? (account.productionAccessEnabled ? "Out of the sandbox (production access)" : "In the sandbox") : "unknown",
                ],
                [
                  "Current quota",
                  account?.max24HourSend != null ? `${account.max24HourSend.toLocaleString("en-US")} / 24 h, ${account.maxSendRate} / s` : "unknown",
                ],
                [
                  "Latest review",
                  account?.reviewStatus ? (
                    <span key="r">
                      <Badge variant="outline" className="mr-2">
                        {account.reviewStatus}
                      </Badge>
                      {REVIEW_LABEL[account.reviewStatus] ?? ""}
                      {account.reviewCaseId ? <span className="text-muted-foreground block text-xs">Case {account.reviewCaseId}</span> : null}
                    </span>
                  ) : (
                    "AWS reports no production-access review for this account."
                  ),
                ],
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Questionnaire</CardTitle>
          <CardDescription>Saved as a draft at each step. Leave anything blank rather than guess — blank answers are left out, never filled in.</CardDescription>
        </CardHeader>
        <CardContent>
          <SandboxQuestionnaire initial={draft} facts={facts} defaultRegion={credential?.awsRegion ?? null} />
        </CardContent>
      </Card>

      <Card id="request">
        <CardHeader>
          <CardTitle>Generated request</CardTitle>
          <CardDescription>
            Structured for the SES “Request production access” form (the fields of SES{" "}
            <code>PutAccountDetails</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!built.ok ? (
            built.tooLong ? (
              <Alert variant="destructive">
                <AlertTitle>Too long for AWS</AlertTitle>
                <AlertDescription>The use-case description exceeds AWS&apos;s 5,000-character limit. Shorten your answers.</AlertDescription>
              </Alert>
            ) : (
              <div className="text-sm">
                <p className="font-medium">Answer these to generate the request:</p>
                <ul className="text-muted-foreground mt-1 list-disc pl-5">
                  {built.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )
          ) : (
            <>
              {!reviewed ? (
                <Alert>
                  <FileWarning className="size-4" aria-hidden />
                  <AlertTitle>Draft — for your review</AlertTitle>
                  <AlertDescription>
                    Read every section against its source. Nothing here has been sent anywhere, and copying is
                    enabled only after you confirm it below.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <ShieldCheck className="size-4" aria-hidden />
                  <AlertTitle>Reviewed</AlertTitle>
                  <AlertDescription>
                    Confirmed by {row?.reviewedBy} at {row?.reviewedAt ? formatDateTime(row.reviewedAt) : ""}. Any
                    change to the answers or the included facts will require a new review.
                  </AlertDescription>
                </Alert>
              )}

              <Fields
                items={[
                  ["Mail type", built.request.fields.mailType === "TRANSACTIONAL" ? "Transactional" : "Marketing"],
                  ["Website URL", built.request.fields.websiteUrl],
                  ["Contact language", built.request.fields.contactLanguage === "EN" ? "English" : "Japanese"],
                  ["Additional contacts", built.request.fields.additionalContacts.join(", ") || "—"],
                  ["Region", built.request.region],
                ]}
              />

              <div className="space-y-4">
                <p className="text-sm font-medium">Use case description</p>
                {built.request.sections.map((s) => (
                  <div key={s.heading} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{s.heading}</p>
                      <p className="text-muted-foreground text-xs">Source: {s.source}</p>
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{s.body}</p>
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  {built.request.fields.useCaseDescription.length.toLocaleString("en-US")} / 5,000 characters
                </p>
              </div>

              {built.request.quotaRequest ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Quota increase (separate request)</p>
                  <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap">{built.request.quotaRequest}</pre>
                </div>
              ) : null}

              {!reviewed ? (
                <div className="border-t pt-4">
                  <ReviewForm hash={built.hash} />
                </div>
              ) : (
                <div className="space-y-3 border-t pt-4">
                  <p className="text-sm font-medium">Submit it yourself, in AWS</p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    <li>
                      Open the SES account dashboard for <code>{region}</code> and choose{" "}
                      <em>Request production access</em>.
                    </li>
                    <li>Copy each field below into the matching field of the form, and submit.</li>
                    <li>
                      Come back and press <em>Re-validate</em> above to see the status AWS reports.
                    </li>
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton text={built.request.fields.useCaseDescription} label="Copy use case description" />
                    <CopyButton text={built.request.fields.websiteUrl} label="Copy website URL" />
                    {built.request.fields.additionalContacts.length ? (
                      <CopyButton text={built.request.fields.additionalContacts.join(", ")} label="Copy contacts" />
                    ) : null}
                    {built.request.quotaRequest ? <CopyButton text={built.request.quotaRequest} label="Copy quota request" /> : null}
                    {REGION.test(region) ? (
                      <a
                        href={`https://console.aws.amazon.com/ses/home?region=${region}#/account`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
                      >
                        Open SES console <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Nothing is submitted by this platform. AWS decides the outcome; approval is not implied by
                    anything on this page.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
