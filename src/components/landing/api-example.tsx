import { Copy, KeyRound, Repeat, Timer } from "lucide-react";

import { SectionKicker } from "@/components/landing/section-kicker";

const KEY = "text-sky-300";
const STR = "text-emerald-300";
const PUNCT = "text-white/40";
const METHOD = "text-sky-300 font-semibold";

const FEATURES = [
  {
    icon: Repeat,
    title: "Idempotency-Key header",
    body: "Retried requests are deduplicated server-side, so a network retry never double-sends.",
  },
  {
    icon: KeyRound,
    title: "Templates or inline content",
    body: "Send HTML/text inline with variables, or reference a stored template by id.",
  },
  {
    icon: Timer,
    title: "Enforced before the queue",
    body: "Per-key and per-account rate limits are checked before a message is ever persisted.",
  },
];

export function ApiExample() {
  return (
    <section id="api" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="04" label="Developer experience" />
        <div className="grid gap-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
              A developer API, not an AWS SDK call.
            </h2>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Send with a bearer API key over HTTP. Ops-Free authenticates the
              key, checks the suppression list, durably queues the message and
              hands it to SES from your AWS account. The response comes back
              before delivery completes — status updates arrive through the
              dashboard and your connected webhook.
            </p>

            <ul className="mt-8 space-y-5">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex gap-3.5">
                  <span className="bg-primary/10 text-primary mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">
                    <f.icon className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed">{f.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-[oklch(0.15_0.012_264)] shadow-lg ring-1 ring-black/[0.03]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-white/15" aria-hidden />
                <span className="size-2.5 rounded-full bg-white/15" aria-hidden />
                <span className="size-2.5 rounded-full bg-white/15" aria-hidden />
              </div>
              <p className="font-mono text-[0.7rem] text-white/40">send.http</p>
              <Copy className="size-3.5 text-white/30" aria-hidden />
            </div>

            <pre className="overflow-x-auto px-5 py-5 font-mono text-[0.8rem] leading-relaxed text-white/90">
              <span className={METHOD}>POST</span> /api/v1/send{"\n"}
              <span className="text-white/40">Authorization:</span> Bearer sk_live_...{"\n"}
              <span className="text-white/40">Content-Type:</span> application/json{"\n\n"}
              <span className={PUNCT}>{"{"}</span>{"\n"}
              {"  "}
              <span className={KEY}>&quot;from&quot;</span>
              <span className={PUNCT}>:</span> <span className={STR}>&quot;hello@example.com&quot;</span>
              <span className={PUNCT}>,</span>
              {"\n"}
              {"  "}
              <span className={KEY}>&quot;to&quot;</span>
              <span className={PUNCT}>:</span> [<span className={STR}>&quot;user@example.com&quot;</span>]
              <span className={PUNCT}>,</span>
              {"\n"}
              {"  "}
              <span className={KEY}>&quot;subject&quot;</span>
              <span className={PUNCT}>:</span> <span className={STR}>&quot;Welcome&quot;</span>
              <span className={PUNCT}>,</span>
              {"\n"}
              {"  "}
              <span className={KEY}>&quot;html&quot;</span>
              <span className={PUNCT}>:</span> <span className={STR}>&quot;&lt;h1&gt;Hello&lt;/h1&gt;&quot;</span>
              {"\n"}
              <span className={PUNCT}>{"}"}</span>
            </pre>

            <div className="border-t border-white/10 bg-white/[0.02] px-5 py-5">
              <p className="mb-3 font-mono text-[0.7rem] text-emerald-400/70">202 Accepted</p>
              <pre className="overflow-x-auto font-mono text-[0.8rem] leading-relaxed text-white/90">
                <span className={PUNCT}>{"{"}</span>
                {"\n"}
                {"  "}
                <span className={KEY}>&quot;id&quot;</span>
                <span className={PUNCT}>:</span> <span className={STR}>&quot;3f2a1c9e-...&quot;</span>
                <span className={PUNCT}>,</span>
                {"\n"}
                {"  "}
                <span className={KEY}>&quot;status&quot;</span>
                <span className={PUNCT}>:</span> <span className={STR}>&quot;queued&quot;</span>
                <span className={PUNCT}>,</span>
                {"\n"}
                {"  "}
                <span className={KEY}>&quot;message&quot;</span>
                <span className={PUNCT}>:</span>{" "}
                <span className={STR}>&quot;Accepted for asynchronous delivery&quot;</span>
                {"\n"}
                <span className={PUNCT}>{"}"}</span>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
