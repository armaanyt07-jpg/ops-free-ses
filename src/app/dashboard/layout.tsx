import { AppNav } from "@/components/dashboard/app-nav";
import { getActiveEnvironment } from "@/server/environment";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <AppNav email={tenant.email} environment={environment} />
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
