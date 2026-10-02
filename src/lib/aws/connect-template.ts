import { EVENTS_ACTIONS, REQUIRED_ACTIONS, ROUTE53_ACTIONS } from "@/lib/aws/iam-policy";

/**
 * The CloudFormation template behind one-click "Connect AWS" (Phase 10).
 *
 * It creates ONE thing in the customer's account: an IAM role that only the
 * platform can assume, and only while presenting the customer's own
 * `ExternalId`. Its permissions are exactly the actions in `iam-policy.ts`, the
 * same list the access-key option documents, so the two ways of connecting can
 * never differ in what we can do.
 *
 * A custom resource then tells our webhook the role's ARN, so the customer
 * pastes nothing. The template is also served from `/aws-connect.yaml` so a
 * careful customer can read it before pressing Create.
 */
export const CONNECT_TEMPLATE_VERSION = "2026-10-02";
export const CONNECT_ROLE_PREFIX = "OpsFreeSES-";

const lines = (actions: readonly string[], indent: string) => actions.map((a) => `${indent}- ${a}`).join("\n");

export function buildConnectTemplate(): string {
  return `AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Ops-Free SES: lets Ops-Free send email through YOUR Amazon SES account.
  Creates one IAM role that only Ops-Free can assume (and only with your
  ExternalId). Nothing is stored; delete this stack to revoke access.
Metadata:
  TemplateVersion: "${CONNECT_TEMPLATE_VERSION}"

Parameters:
  ConnectionId:
    Type: String
    Description: Names the role. Set for you; leave as is.
    AllowedPattern: "[A-Za-z0-9]{6,32}"
  ExternalId:
    Type: String
    Description: Proves this request came from your Ops-Free account. Set for you; leave as is.
    AllowedPattern: "[A-Za-z0-9_+=,.@:/-]{16,200}"
    NoEcho: false
  PlatformPrincipalArn:
    Type: String
    Description: The Ops-Free identity allowed to assume the role. Set for you; leave as is.
    AllowedPattern: "arn:aws:iam::[0-9]{12}:(user|role)/[A-Za-z0-9_+=,.@/-]+"
  CallbackTopicArn:
    Type: String
    Description: Where this stack reports the role's ARN. Set for you; leave as is.
    AllowedPattern: "arn:aws:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]+"

Resources:
  OpsFreeRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub "${CONNECT_ROLE_PREFIX}\${ConnectionId}"
      Description: Lets Ops-Free send email through this account's Amazon SES.
      MaxSessionDuration: 3600
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              AWS: !Ref PlatformPrincipalArn
            Action: sts:AssumeRole
            Condition:
              StringEquals:
                sts:ExternalId: !Ref ExternalId
      Policies:
        - PolicyName: OpsFreeSES
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: SesAndEvents
                Effect: Allow
                Action:
${lines([...REQUIRED_ACTIONS, ...EVENTS_ACTIONS], "                  ")}
                Resource: "*"
              - Sid: OptionalRoute53DkimRecords
                Effect: Allow
                Action:
${lines(ROUTE53_ACTIONS, "                  ")}
                Resource: "*"

  TellOpsFree:
    Type: Custom::OpsFreeConnect
    Properties:
      ServiceToken: !Ref CallbackTopicArn
      ExternalId: !Ref ExternalId
      RoleArn: !GetAtt OpsFreeRole.Arn

Outputs:
  RoleArn:
    Description: The role Ops-Free assumes.
    Value: !GetAtt OpsFreeRole.Arn
`;
}
