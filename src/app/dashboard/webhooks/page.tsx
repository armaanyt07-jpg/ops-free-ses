import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AMBER, GREEN } from "@/components/dashboard/badge-tones";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Time } from "@/components/dashboard/primitives";
import { ConnectEventsButton } from "@/components/dashboard/setup-actions";
import { TopicForm } from "@/components/dashboard/topic-form";
import { listRecentEvents } from "@/server/sns-events";
import { webhookEndpoint } from "@/server/public-url";
import { listTopics } from "@/server/sns-topics";
import { requireTenant } from "@/server/tenant";

import { deleteTopic } from "./actions";

export const dynamic = "force-dynamic";

const TOPIC_STYLE: Record<string, { variant: "secondary" | "destructive"; className?: string }> = {
  confirmed: { variant: "secondary", className: GREEN },
  pending: { variant: "secondary", className: AMBER },
  unsubscribed: { variant: "destructive" },
};

export default async function WebhooksPage() {
  const tenant = await requireTenant();
  const [topics, events, endpoint] = await Promise.all([
    listTopics(tenant.id),
    listRecentEvents(tenant.id, 25),
    webhookEndpoint(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Webhooks"
        description="SES reports deliveries, bounces and complaints through Amazon SNS. Each message is signature-verified, matched to your topic, and processed exactly once."
      />

      <Card>
        <CardHeader>
          <CardTitle>Connect automatically</CardTitle>
          <CardDescription>
            Creates an SNS topic and an SES configuration set in your AWS account, subscribes this
            app to it, and applies it to your domains and addresses. Safe to run again, for example
            after adding a domain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectEventsButton local={endpoint.local} />
        </CardContent>
      </Card>

      <details className="group space-y-6">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm font-medium">
          Set it up manually instead
        </summary>
        <div className="mt-6 space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Endpoint</CardTitle>
              <CardDescription>Subscribe this URL to your SNS topic.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <code className="bg-muted block rounded-md px-3 py-2 text-sm break-all select-all">
                {endpoint.url}
              </code>
              {endpoint.local ? (
                <Alert>
                  <AlertTitle>This is a local address</AlertTitle>
                  <AlertDescription>
                    SNS cannot reach localhost. Use the URL of a deployed instance,
                    or a tunnel, when subscribing.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Setup</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>
                  In the AWS account and region of your SES identity, create a{" "}
                  <strong>standard</strong> SNS topic (not FIFO).
                </li>
                <li>
                  Register its ARN below. <strong>Do this first</strong> — a
                  subscription request from an unregistered topic is refused.
                </li>
                <li>
                  In SNS, create an <strong>HTTPS</strong> subscription to the
                  endpoint above. Leave <em>raw message delivery</em> off: the
                  signature lives in the envelope it removes. The subscription is
                  confirmed automatically within seconds.
                </li>
                <li>
                  In SES, open each verified identity → <em>Notifications</em>, and
                  set the Bounce, Complaint and Delivery feedback topics to this
                  topic. (A configuration-set event destination publishing to the
                  same topic works too.)
                </li>
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Register your topic</CardTitle>
            </CardHeader>
            <CardContent>
              <TopicForm />
            </CardContent>
          </Card>
        </div>
      </details>

      <Card>
        <CardHeader>
          <CardTitle>Registered topics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {topics.length === 0 ? (
            <p className="text-muted-foreground text-sm">No topics registered.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic ARN</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Last message</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic) => (
                  <TableRow key={topic.id}>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">
                      {topic.topicArn}
                      {topic.managed ? (
                        <span className="text-muted-foreground mt-1 block font-sans">
                          Set up automatically
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={TOPIC_STYLE[topic.status]?.variant ?? "secondary"}
                        className={cn(TOPIC_STYLE[topic.status]?.className)}
                      >
                        {topic.status === "pending"
                          ? "awaiting confirmation"
                          : topic.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {topic.lastMessageAt ? <Time date={topic.lastMessageAt} /> : "never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={deleteTopic}>
                        <input type="hidden" name="id" value={topic.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
          <CardDescription>
            &ldquo;Unmatched&rdquo; means the SES message id is not one this
            platform sent — for example, mail sent through the same identity
            from elsewhere. Bounces and complaints still update suppression.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">No events received yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>SES message</TableHead>
                  <TableHead>Log</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      <Time date={e.receivedAt} />
                    </TableCell>
                    <TableCell>{e.eventType ?? e.messageType}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.sesMessageId ?? "—"}
                    </TableCell>
                    <TableCell>
                      {e.sesMessageId === null ? (
                        "—"
                      ) : e.logId ? (
                        <Badge variant="outline">matched</Badge>
                      ) : (
                        <Badge variant="secondary">unmatched</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
