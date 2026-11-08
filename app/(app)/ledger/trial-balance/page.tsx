import { PageHeader } from "@/components/page-header";
import { getTrialBalance } from "@/lib/actions/finance";
import Link from "next/link";

export default async function TrialBalancePage() {
  const response = await getTrialBalance();
  const rows = response.success ? response.data : [];

  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Trial Balance" />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl shadow-sm border-transparent bg-card p-6">
          <p className="text-xs text-muted-foreground">Total Debit</p>
          <p className="font-mono text-3xl font-black tracking-tight tabular-nums">
            ৳{totalDebit.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl shadow-sm border-transparent bg-card p-6">
          <p className="text-xs text-muted-foreground">Total Credit</p>
          <p className="font-mono text-3xl font-black tracking-tight tabular-nums">
            ৳{totalCredit.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl shadow-sm border-transparent bg-card p-6">
          <p className="text-xs text-muted-foreground">Difference</p>
          <p
            className={`font-mono text-3xl font-black tracking-tight tabular-nums ${
              Math.abs(totalDebit - totalCredit) < 0.01
                ? "text-primary"
                : "text-destructive"
            }`}
          >
            ৳{Math.abs(totalDebit - totalCredit).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl shadow-sm border-transparent bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2 text-left font-medium">Code</th>
              <th className="px-4 py-2 text-left font-medium">Account</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Debit</th>
              <th className="px-4 py-2 text-right font-medium">Credit</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No ledger data found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono">{row.code}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/ledger/transactions?accountId=${row.id}`}
                      className="text-primary hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.type}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    ৳{row.debit.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    ৳{row.credit.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    ৳{row.balance.toLocaleString()}
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
