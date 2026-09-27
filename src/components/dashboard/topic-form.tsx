"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { addTopic, type TopicFormState } from "@/app/dashboard/webhooks/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Registering…" : "Register topic"}
    </Button>
  );
}

export function TopicForm() {
  const [state, formAction] = useActionState<TopicFormState, FormData>(
    addTopic,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full flex-1 space-y-2 sm:w-auto sm:min-w-72">
          <Label htmlFor="topicArn">SNS topic ARN</Label>
          <Input
            id="topicArn"
            name="topicArn"
            placeholder="arn:aws:sns:us-east-1:123456789012:ses-events"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            required
          />
        </div>
        <Submit />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.success ? (
        <Alert>
          <AlertDescription>{state.success}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
