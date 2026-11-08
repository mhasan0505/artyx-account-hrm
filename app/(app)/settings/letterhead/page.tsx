import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAccessibleOutlets, getCompanyLetterhead, getOutlet } from "@/lib/actions/settings";
import { LetterheadPreview } from "./letterhead-preview";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Company Letterhead",
};

interface LetterHeadPageProps {
  searchParams: Promise<{ outletId?: string }>;
}

export default async function LetterHeadPage({ searchParams }: LetterHeadPageProps) {
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
  const initialLetterhead = targetOutletId ? await getCompanyLetterhead(targetOutletId) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-xs">
              <Link href={targetOutletId ? `/settings?outletId=${encodeURIComponent(targetOutletId)}` : '/settings'}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                Store Settings
              </Link>
            </Button>
            {outlet && (
              <span className="text-xs text-muted-foreground font-mono">
                · {outlet.name} ({outlet.code})
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Company Letterhead</h1>
          <p className="text-sm text-muted-foreground">
            Design, persist, and print official company letterhead synced across all devices.
          </p>
        </div>

        {accessibleOutlets.length > 1 && (
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">Switch Location:</span>
            <div className="flex flex-wrap gap-1">
              {accessibleOutlets.map((o) => (
                <Button
                  key={o.id}
                  variant={o.id === targetOutletId ? "default" : "outline"}
                  size="sm"
                  asChild
                  className="h-7 text-xs font-medium"
                >
                  <Link href={`/settings/letterhead?outletId=${encodeURIComponent(o.id)}`}>
                    {o.name}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <LetterheadPreview
        key={targetOutletId || "empty"}
        outlet={outlet}
        initialLetterhead={initialLetterhead}
      />
    </div>
  );
}
