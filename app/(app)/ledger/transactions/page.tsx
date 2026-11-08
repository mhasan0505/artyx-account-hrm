import { PageHeader } from "@/components/page-header";
import { getLedgerTransactions, getTrialBalance } from "@/lib/actions/finance";
import Link from "next/link";

type TransactionsPageProps = {
  searchParams?:
    | Promise<{ accountId?: string; from?: string; to?: string }>
    | { accountId?: string; from?: string; to?: string };
};

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const params = searchParams ? await searchParams : {};
  const accountId = params.accountId?.trim() || "";
  const from = params.from?.trim() || "";
  const to = params.to?.trim() || "";

  const [entries, accountsRes] = await Promise.all([
    getLedgerTransactions({
      accountId: accountId || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    getTrialBalance(),
  ]);
  const accounts = accountsRes.success ? accountsRes.data : [];

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Ledger Transactions" />

      <form className="grid grid-cols-1 gap-3 rounded-xl shadow-sm border-transparent bg-card/60 backdrop-blur-xs p-6 md:grid-cols-4">
        <select
          name="accountId"
          defaultValue={accountId}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All Accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} - {account.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        />
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-xl shadow-sm border-transparent bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Account</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-left font-medium">Reference</th>
              <th className="px-4 py-2 text-left font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No transactions found.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    {entry.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono">{entry.account.code}</span>{" "}
                    {entry.account.name}
                  </td>
                  <td className="px-4 py-2">{entry.type}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    ৳{Number(entry.amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    {entry.sale ? (
                      <Link
                        href={`/orders/${entry.sale.id}`}
                        className="text-primary hover:underline"
                      >
                        {entry.sale.saleNumber}
                      </Link>
                    ) : (
                      entry.referenceType || "-"
                    )}
                  </td>
                  <td className="px-4 py-2">{entry.description}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
