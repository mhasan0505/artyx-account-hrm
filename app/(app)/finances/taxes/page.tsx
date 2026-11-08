import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getTaxRates } from "@/lib/actions/settings";
import Link from "next/link";

export default async function FinancesTaxesDashboardPage() {
  const taxRates = await getTaxRates();

  const defaultRate = taxRates.find((rate) => rate.isDefault) ?? null;
  const activeRates = taxRates.filter((rate) => rate.isActive);

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentChangesCount = taxRates.filter(
    (rate) => new Date(rate.updatedAt).getTime() >= sevenDaysAgo,
  ).length;

  const recentChanges = [...taxRates]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 8)
    .map((rate) => {
      const action =
        Math.abs(
          new Date(rate.updatedAt).getTime() -
            new Date(rate.createdAt).getTime(),
        ) < 1000
          ? "Created"
          : "Updated";

      return {
        id: rate.id,
        name: rate.name,
        rate: Number(rate.rate),
        isDefault: rate.isDefault,
        isActive: rate.isActive,
        action,
        changedAt: rate.updatedAt,
      };
    });

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <PageHeader title="Taxes & VAT Dashboard" />
        <Button asChild>
          <Link href="/settings/tax">Manage Tax Rates</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Default Tax</p>
          <p className="text-lg font-semibold">
            {defaultRate ? defaultRate.name : "No default tax"}
          </p>
          <p className="font-mono text-sm text-muted-foreground">
            {defaultRate ? `${Number(defaultRate.rate).toFixed(2)}%` : "0.00%"}
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Active Rates</p>
          <p className="font-mono text-2xl font-bold">{activeRates.length}</p>
          <p className="text-sm text-muted-foreground">
            Currently enabled tax rates
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Recent Changes (7 days)
          </p>
          <p className="font-mono text-2xl font-bold">{recentChangesCount}</p>
          <p className="text-sm text-muted-foreground">
            Based on tax rate update timestamps
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2 text-left font-medium">Tax Name</th>
              <th className="px-4 py-2 text-right font-medium">Rate</th>
              <th className="px-4 py-2 text-left font-medium">Action</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Changed At</th>
            </tr>
          </thead>
          <tbody>
            {recentChanges.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No tax activity found.
                </td>
              </tr>
            ) : (
              recentChanges.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {row.rate.toFixed(2)}%
                  </td>
                  <td className="px-4 py-2">{row.action}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {row.isActive ? "Active" : "Inactive"}
                    </span>
                    {row.isDefault ? (
                      <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        Default
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(row.changedAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
