import { redirect } from "next/navigation";

import { ApiExample } from "@/components/landing/api-example";
import { Audience } from "@/components/landing/audience";
import { Comparison } from "@/components/landing/comparison";
import { Cost } from "@/components/landing/cost";
import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { FinalCta } from "@/components/landing/final-cta";
import { Flow } from "@/components/landing/flow";
import { LandingFooter } from "@/components/landing/footer";
import { GetStarted } from "@/components/landing/get-started";
import { Hero } from "@/components/landing/hero";
import { LandingNav } from "@/components/landing/nav";
import { Problems } from "@/components/landing/problems";
import { Reveal } from "@/components/landing/reveal";
import { getTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tenant = await getTenant();
  if (tenant) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <LandingNav />
      <main>
        <Hero />
        <Reveal>
          <Problems />
        </Reveal>
        <Reveal>
          <Comparison />
        </Reveal>
        <Reveal>
          <Flow />
        </Reveal>
        <Reveal>
          <GetStarted />
        </Reveal>
        <Reveal>
          <ApiExample />
        </Reveal>
        <Reveal>
          <DashboardPreview />
        </Reveal>
        <Reveal>
          <Cost />
        </Reveal>
        <Reveal>
          <Audience />
        </Reveal>
        <Reveal>
          <FinalCta />
        </Reveal>
      </main>
      <LandingFooter />
    </div>
  );
}
