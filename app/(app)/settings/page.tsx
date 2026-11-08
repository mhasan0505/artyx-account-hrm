import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAccessibleOutlets, getOutlet } from "@/lib/actions/settings";
import { SettingsForm } from "./settings-form";

export const metadata = {
  title: "Store Settings",
};

interface StoreSettingsPageProps {
  searchParams: Promise<{ outletId?: string }>;
}

export default async function StoreSettingsPage({
  searchParams,
}: StoreSettingsPageProps) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { outletId: outletIdParam } = await searchParams;
  const accessibleOutlets = await getAccessibleOutlets();

  // Resolve target outlet
  let targetOutletId: string | undefined = undefined;
  if (outletIdParam && accessibleOutlets.some((o) => o.id === outletIdParam)) {
    targetOutletId = outletIdParam;
  } else if (
    session.user.outletId &&
    accessibleOutlets.some((o) => o.id === session.user.outletId)
  ) {
    targetOutletId = session.user.outletId;
  } else if (accessibleOutlets.length > 0) {
    targetOutletId = accessibleOutlets[0].id;
  }

  const outlet = targetOutletId ? await getOutlet(targetOutletId) : null;

  return (
    <SettingsForm
      key={targetOutletId || "empty"}
      outlet={outlet}
      outlets={accessibleOutlets}
      selectedOutletId={targetOutletId}
      userRole={session.user.role}
    />
  );
}
