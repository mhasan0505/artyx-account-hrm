import { EditChartOfAccountDialog } from '@/components/modals/edit-chart-of-account-dialog'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getChartOfAccountsList } from '@/lib/actions/master-setup'
import { ArrowLeft, BookOpen } from 'lucide-react'
import Link from 'next/link'

export default async function ChartOfAccountsPage() {
  const accounts = await getChartOfAccountsList()

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-2 h-8 text-muted-foreground hover:text-foreground"
            >
              <Link href="/master-setup">
                <ArrowLeft className="size-4 mr-1" />
                Master Setup
              </Link>
            </Button>
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Chart of Accounts
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Standard double-entry accounting structure configured for Artyx Digital agency ledger transactions.
          </p>
        </div>
      </div>

      {/* Info Callout */}
      <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground flex items-start gap-3">
        <BookOpen className="size-4.5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-foreground">Ledger System Architecture</p>
          <p className="mt-0.5 leading-relaxed">
            The Chart of Accounts reflects system-wide financial classification categories used by POS sales, expenses, cash drawer sessions, and bank reconciliations. Account names can be edited to fix typos while account codes and ledger relationships remain safely preserved.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-24 font-semibold text-foreground">Code</TableHead>
              <TableHead className="font-semibold text-foreground">Account Name</TableHead>
              <TableHead className="font-semibold text-foreground">Type</TableHead>
              <TableHead className="font-semibold text-foreground">Status</TableHead>
              <TableHead className="w-24 text-right font-semibold text-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No chart of accounts records found in system.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map(acc => (
                <TableRow key={acc.id} className="hover:bg-muted/40">
                  <TableCell className="font-mono text-xs font-bold text-foreground">
                    {acc.code}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {acc.name}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                        acc.type === 'ASSET'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : acc.type === 'LIABILITY'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : acc.type === 'EQUITY'
                          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                          : acc.type === 'INCOME'
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {acc.type}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        acc.isActive
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {acc.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <EditChartOfAccountDialog account={acc} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
