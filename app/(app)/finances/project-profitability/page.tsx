import { getProjectProfitability } from '@/lib/actions/agency-profit'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, BarChart2, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

function fmt(val: number): string {
  const abs = Math.abs(Math.round(val)).toLocaleString('en-US')
  return val < 0 ? `-৳${abs}` : `৳${abs}`
}

export default async function ProjectProfitabilityPage() {
  const { canViewLaborCosts, projects } = await getProjectProfitability()

  const totalAgi = projects.reduce((s, p) => s + p.totalInvoiced, 0)
  const totalLoggedHours = projects.reduce((s, p) => s + p.totalLoggedHours, 0)
  const blendedEhr = totalLoggedHours > 0 ? Math.round(totalAgi / totalLoggedHours) : 0
  const atRiskCount = projects.filter(p => p.isBelowMarginGuardrail).length

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-2 py-2 sm:px-5 sm:py-4 lg:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-foreground/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider text-muted-foreground">
            <Link
              href="/finances/profit-loss"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3" />
              P&amp;L STATEMENT
            </Link>
            <span className="opacity-35">/</span>
            <span>UNIT ECONOMICS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[28px] leading-none">
            Project Margins, EHR &amp; WIP
          </h1>
          <p className="text-xs text-muted-foreground">
            True project profitability on AGI (Pass-Through excluded) with Effective Hourly Rate and Over/Under Billings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!canViewLaborCosts ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-foreground/[0.1] bg-muted/50 px-3 py-2 text-[11px] font-mono text-muted-foreground">
              <Lock className="size-3.5" />
              Labor costs restricted to Admin/Accountant
            </span>
          ) : null}
          <Link
            href="/finances/revenue-recognition"
            className="inline-flex h-9 items-center rounded-xl border border-foreground/[0.1] bg-card px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
          >
            Revenue Recognition →
          </Link>
        </div>
      </header>

      {/* Summary Strip */}
      <section className="grid grid-cols-2 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        <div className="p-4 sm:p-5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Portfolio AGI Invoiced
          </span>
          <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
            {fmt(totalAgi)}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Blended EHR
          </span>
          <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
            {blendedEhr > 0 ? `${fmt(blendedEhr)}/hr` : '—'}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Total Logged Hours
          </span>
          <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
            {totalLoggedHours.toFixed(1)}h
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Margin Guardrail (&lt;45%)
          </span>
          <p
            className={cn(
              'mt-1.5 font-mono text-xl font-semibold tabular-nums',
              atRiskCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-primary'
            )}
          >
            {atRiskCount} {atRiskCount === 1 ? 'Project' : 'Projects'}
          </p>
        </div>
      </section>

      {/* Main Architectural Table */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-foreground/15 bg-card py-16 text-center">
          <BarChart2 className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">No projects recorded yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create an agency project and log tasks/invoices to inspect EHR and margins.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-foreground/[0.08] bg-card">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="border-b border-foreground/[0.08] bg-muted/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Project &amp; Client</th>
                <th className="px-4 py-3 text-right">AGI Invoiced</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">EHR</th>
                {canViewLaborCosts ? (
                  <th className="px-4 py-3 text-right">Direct Labor</th>
                ) : null}
                <th className="px-4 py-3 text-right">Direct Vendor</th>
                <th className="px-4 py-3 text-right">Over / Under Billed</th>
                <th className="px-4 py-3 text-right">Gross Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.06]">
              {projects.map(p => (
                <tr key={p.id} className="transition-colors hover:bg-muted/35">
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-semibold text-foreground hover:text-primary transition-colors block"
                    >
                      {p.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">{p.projectCode}</span>
                      <span>·</span>
                      <span>{p.clientName}</span>
                      {p.departmentName ? (
                        <>
                          <span>·</span>
                          <span>{p.departmentName}</span>
                        </>
                      ) : null}
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    <span className="font-semibold text-foreground block">
                      {fmt(p.totalInvoiced)}
                    </span>
                    {p.passThroughInvoiced > 0 ? (
                      <span className="text-[10px] text-muted-foreground block">
                        +{fmt(p.passThroughInvoiced)} pass-thru
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground block">
                        Contract {fmt(p.contractValue)}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                    {p.totalLoggedHours > 0 ? `${p.totalLoggedHours}h` : '—'}
                  </td>

                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    <span className="font-semibold text-foreground">
                      {p.ehr > 0 ? `${fmt(p.ehr)}/h` : '—'}
                    </span>
                  </td>

                  {canViewLaborCosts ? (
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums text-muted-foreground">
                      <span>{p.directLaborCost !== null ? fmt(p.directLaborCost) : '—'}</span>
                      {p.gmrol && p.gmrol > 0 ? (
                        <span className="block text-[10px] text-muted-foreground/75">
                          GMROL {p.gmrol}x
                        </span>
                      ) : null}
                    </td>
                  ) : null}

                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-muted-foreground">
                    {fmt(p.directExpenses)}
                  </td>

                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    {p.billingPosition.status === 'BALANCED' ? (
                      <span className="text-[11px] text-muted-foreground">Balanced</span>
                    ) : p.billingPosition.status === 'UNDER_BILLED' ? (
                      <div>
                        <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          WIP {fmt(p.billingPosition.unbilledAsset)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          Under-billed
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-[11px] font-semibold text-foreground">
                          Def {fmt(p.billingPosition.deferredLiability)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          Over-billed
                        </span>
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {p.isBelowMarginGuardrail ? (
                        <AlertTriangle
                          className="size-3.5 text-amber-500"
                          aria-label="Below 45% gross margin guardrail"
                        />
                      ) : null}
                      <span
                        className={cn(
                          'font-semibold',
                          p.marginPct >= 45
                            ? 'text-primary'
                            : p.marginPct >= 20
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                        )}
                      >
                        {p.marginPct}%
                      </span>
                    </div>
                    <span className="block text-[10px] text-muted-foreground">
                      {fmt(p.netMargin)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
