import { redirect } from "next/navigation";

import { getTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tenant = await getTenant();
  redirect(tenant ? "/dashboard" : "/login");
}
