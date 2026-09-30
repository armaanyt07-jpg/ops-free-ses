/**
 * The IAM policy a customer attaches to the user whose access key they give
 * us. One source for every place that shows it (landing page, setup flow, AWS
 * page), so the documented permissions never drift from what the code calls.
 *
 * - SES send + identity: FR-1/FR-2, needed from day one.
 * - SES configuration set + SNS: Phase 8 "Connect events", which wires
 *   bounce/complaint/delivery events without the customer opening SNS.
 * - Route 53: optional; lets domain setup publish the DKIM records itself when
 *   the domain's DNS is hosted in the same AWS account.
 */
export const REQUIRED_ACTIONS = [
  "ses:GetAccount",
  "ses:SendEmail",
  "ses:CreateEmailIdentity",
  "ses:GetEmailIdentity",
] as const;

export const EVENTS_ACTIONS = [
  "ses:CreateConfigurationSet",
  "ses:CreateConfigurationSetEventDestination",
  "ses:UpdateConfigurationSetEventDestination",
  "ses:PutEmailIdentityConfigurationSetAttributes",
  "sns:CreateTopic",
  "sns:Subscribe",
] as const;

export const ROUTE53_ACTIONS = [
  "route53:ListHostedZonesByName",
  "route53:ChangeResourceRecordSets",
] as const;

export const IAM_POLICY = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [...REQUIRED_ACTIONS, ...EVENTS_ACTIONS],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: [...ROUTE53_ACTIONS],
        Resource: "*",
      },
    ],
  },
  null,
  2,
);

/** Console page where the customer creates the IAM user. */
export const IAM_CREATE_USER_URL =
  "https://console.aws.amazon.com/iam/home#/users/create";
