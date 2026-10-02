import { ConnectAwsButton } from "@/components/dashboard/connect-aws";
import { CredentialForm } from "@/components/dashboard/credential-form";
import { IamSetup } from "@/components/dashboard/iam-setup";
import { oneClickConnectAvailable } from "@/lib/aws/platform";

/**
 * The two ways to connect AWS. One click when the platform is set up for it,
 * with access keys tucked under "Advanced"; otherwise just the access-key steps,
 * exactly as before Phase 10.
 */
export function AwsConnectOptions() {
  if (!oneClickConnectAvailable()) {
    return (
      <div className="space-y-6">
        <IamSetup />
        <CredentialForm />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ConnectAwsButton />
      <details className="group rounded-lg border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced: use an IAM access key instead</summary>
        <div className="mt-4 space-y-6">
          <IamSetup />
          <CredentialForm />
        </div>
      </details>
    </div>
  );
}
