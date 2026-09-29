import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[oklch(0.15_0.012_264)] text-[oklch(0.97_0.006_260)]">
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,black_20%,transparent_80%)]"
      />
      <div
        aria-hidden
        className="bg-primary/20 absolute top-1/2 left-1/2 h-64 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
      />

      <div className="relative mx-auto max-w-6xl px-6 py-24 text-center sm:py-32">
        <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Stop building email infrastructure around SES.
          <br />
          Start building your product.
        </h2>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-11 px-6 text-sm">
            <Link href="/signup">
              Start Building
              <ArrowUpRight aria-hidden />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-11 border-white/15 bg-transparent px-6 text-sm text-white hover:bg-white/10 hover:text-white"
          >
            <a href="#api">Read the Docs</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
