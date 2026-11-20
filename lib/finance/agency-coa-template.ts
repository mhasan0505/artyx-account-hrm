import {
  AccountType,
  AgencyAccountBucket,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

export interface AgencyCoaTemplateAccount {
  code: string
  name: string
  type: AccountType
  agencyBucket: AgencyAccountBucket
  parentCode?: string
  description: string
}

/**
 * Canonical Hybrid Software Agency Chart of Accounts.
 * Codes are chosen to coexist cleanly with existing seed accounts (1000-5320).
 */
export const AGENCY_COA_TEMPLATE: readonly AgencyCoaTemplateAccount[] = [
  // Assets
  {
    code: '1310',
    name: 'Unbilled Revenue (WIP)',
    type: AccountType.ASSET,
    agencyBucket: AgencyAccountBucket.UNBILLED_REVENUE,
    parentCode: '1000',
    description: 'Earned milestone/project work completed before invoicing',
  },
  {
    code: '1390',
    name: 'Allowance for Doubtful Accounts',
    type: AccountType.ASSET,
    agencyBucket: AgencyAccountBucket.BAD_DEBT_ALLOWANCE,
    parentCode: '1000',
    description: 'Contra-asset reserve against overdue Accounts Receivable',
  },

  // Liabilities
  {
    code: '2250',
    name: 'Deferred Revenue (Unearned)',
    type: AccountType.LIABILITY,
    agencyBucket: AgencyAccountBucket.DEFERRED_REVENUE,
    parentCode: '2000',
    description: 'Upfront project deposits and prepaid multi-month retainers',
  },

  // Revenue (Agency Gross Income & Pass-Through Separation)
  {
    code: '4210',
    name: 'Project Engineering & Build Revenue',
    type: AccountType.INCOME,
    agencyBucket: AgencyAccountBucket.REVENUE_PROJECT,
    parentCode: '4000',
    description: 'Earned fixed-fee and milestone software/design project revenue',
  },
  {
    code: '4220',
    name: 'Monthly Retainer & Subscription Revenue',
    type: AccountType.INCOME,
    agencyBucket: AgencyAccountBucket.REVENUE_RETAINER,
    parentCode: '4000',
    description: 'Earned recurring retainer and managed services revenue',
  },
  {
    code: '4290',
    name: 'Client Pass-Through Reimbursements',
    type: AccountType.INCOME,
    agencyBucket: AgencyAccountBucket.PASS_THROUGH_BILLING,
    parentCode: '4000',
    description: 'Client ad spend, third-party APIs, and stock assets billed at cost (excluded from AGI)',
  },
  {
    code: '4500',
    name: 'Foreign Exchange Gain / (Loss)',
    type: AccountType.INCOME,
    agencyBucket: AgencyAccountBucket.FX_GAIN_LOSS,
    parentCode: '4000',
    description: 'Realized currency conversion gain or loss on international invoices',
  },

  // Direct Costs (COGS)
  {
    code: '5110',
    name: 'Direct Delivery Labor (COGS)',
    type: AccountType.EXPENSE,
    agencyBucket: AgencyAccountBucket.COGS_DIRECT_LABOR,
    parentCode: '5000',
    description: 'Loaded billable labor cost logged directly to client projects',
  },
  {
    code: '5120',
    name: 'Subcontractor & Freelance Delivery',
    type: AccountType.EXPENSE,
    agencyBucket: AgencyAccountBucket.COGS_CONTRACTOR,
    parentCode: '5000',
    description: 'External engineers, designers, and media specialists tied to delivery',
  },
  {
    code: '5130',
    name: 'Client Pass-Through Costs (Ad Spend / APIs)',
    type: AccountType.EXPENSE,
    agencyBucket: AgencyAccountBucket.COGS_PASS_THROUGH,
    parentCode: '5000',
    description: 'Direct reimbursable third-party media spend or software billed back to clients',
  },

  // Operating Expenses (Bench & Overhead)
  {
    code: '5215',
    name: 'Unbilled Bench & Internal Capacity',
    type: AccountType.EXPENSE,
    agencyBucket: AgencyAccountBucket.OPEX_BENCH_LABOR,
    parentCode: '5200',
    description: 'Paid delivery payroll not absorbed by billable client projects',
  },
  {
    code: '5245',
    name: 'SaaS, Cloud & Dev Tooling',
    type: AccountType.EXPENSE,
    agencyBucket: AgencyAccountBucket.OPEX_OVERHEAD,
    parentCode: '5200',
    description: 'Internal software subscriptions (AWS, Vercel, Figma, GitHub, AI APIs)',
  },
  {
    code: '5295',
    name: 'Bad Debt Expense',
    type: AccountType.EXPENSE,
    agencyBucket: AgencyAccountBucket.BAD_DEBT_EXPENSE,
    parentCode: '5200',
    description: 'Provision for uncollectible overdue client receivables',
  },
] as const

/**
 * Maps legacy/existing ChartOfAccount codes to their corresponding AgencyAccountBucket
 * so live data is classified cleanly without duplicating accounts.
 */
export const EXISTING_CODE_TO_BUCKET: Record<string, AgencyAccountBucket> = {
  '1100': AgencyAccountBucket.CASH_AND_BANK,
  '1110': AgencyAccountBucket.CASH_AND_BANK,
  '1200': AgencyAccountBucket.CASH_AND_BANK,
  '1300': AgencyAccountBucket.ACCOUNTS_RECEIVABLE,
  '2100': AgencyAccountBucket.ACCOUNTS_PAYABLE,
  '2200': AgencyAccountBucket.DEFERRED_REVENUE,
  '4200': AgencyAccountBucket.REVENUE_PROJECT,
  '5210': AgencyAccountBucket.OPEX_OVERHEAD,
  '5220': AgencyAccountBucket.OPEX_OVERHEAD,
  '5230': AgencyAccountBucket.OPEX_OVERHEAD,
  '5240': AgencyAccountBucket.OPEX_OVERHEAD,
  '5250': AgencyAccountBucket.OPEX_OVERHEAD,
  '5260': AgencyAccountBucket.OPEX_OVERHEAD,
  '5270': AgencyAccountBucket.OPEX_OVERHEAD,
  '5280': AgencyAccountBucket.OPEX_OVERHEAD,
  '5290': AgencyAccountBucket.OPEX_OVERHEAD,
  '5291': AgencyAccountBucket.OPEX_OVERHEAD,
  '5320': AgencyAccountBucket.OPEX_OVERHEAD,
}

type DbLike = PrismaClient | Prisma.TransactionClient

/**
 * Idempotently seeds all Agency CoA accounts and classifies existing standard accounts.
 */
export async function syncAgencyChartOfAccounts(db: DbLike) {
  const createdCodes: string[] = []
  const updatedCodes: string[] = []

  // Ensure root parent accounts exist
  const rootParents: Array<{ code: string; name: string; type: AccountType }> = [
    { code: '1000', name: 'Current Assets', type: AccountType.ASSET },
    { code: '2000', name: 'Current Liabilities', type: AccountType.LIABILITY },
    { code: '4000', name: 'Revenue', type: AccountType.INCOME },
    { code: '5000', name: 'Cost of Goods Sold', type: AccountType.EXPENSE },
    { code: '5200', name: 'Operating Expenses', type: AccountType.EXPENSE },
  ]

  const parentIdByCode = new Map<string, string>()

  for (const root of rootParents) {
    const row = await db.chartOfAccount.upsert({
      where: { code: root.code },
      update: {},
      create: {
        code: root.code,
        name: root.name,
        type: root.type,
        isSystemAccount: true,
      },
    })
    parentIdByCode.set(root.code, row.id)
  }

  // 1. Tag existing known CoA accounts with agencyBucket if not already set
  for (const [code, bucket] of Object.entries(EXISTING_CODE_TO_BUCKET)) {
    const existing = await db.chartOfAccount.findUnique({ where: { code } })
    if (existing && !existing.agencyBucket) {
      await db.chartOfAccount.update({
        where: { id: existing.id },
        data: { agencyBucket: bucket },
      })
      updatedCodes.push(code)
    }
  }

  // 2. Upsert agency-specific template accounts
  for (const acc of AGENCY_COA_TEMPLATE) {
    const existing = await db.chartOfAccount.findUnique({ where: { code: acc.code } })
    const parentId = acc.parentCode ? parentIdByCode.get(acc.parentCode) ?? null : null

    if (!existing) {
      await db.chartOfAccount.create({
        data: {
          code: acc.code,
          name: acc.name,
          type: acc.type,
          agencyBucket: acc.agencyBucket,
          isSystemAccount: true,
          parentId,
        },
      })
      createdCodes.push(acc.code)
    } else if (existing.agencyBucket !== acc.agencyBucket || !existing.isSystemAccount) {
      await db.chartOfAccount.update({
        where: { id: existing.id },
        data: {
          agencyBucket: acc.agencyBucket,
          isSystemAccount: true,
          ...(parentId && !existing.parentId ? { parentId } : {}),
        },
      })
      updatedCodes.push(acc.code)
    }
  }

  return {
    createdCount: createdCodes.length,
    updatedCount: updatedCodes.length,
    createdCodes,
    updatedCodes,
  }
}

/**
 * Resolves a ChartOfAccount ID by agencyBucket (with optional code preference).
 */
export async function findAccountByBucket(
  db: DbLike,
  bucket: AgencyAccountBucket,
  preferredCode?: string
): Promise<string | null> {
  if (preferredCode) {
    const byCode = await db.chartOfAccount.findUnique({
      where: { code: preferredCode },
      select: { id: true },
    })
    if (byCode) return byCode.id
  }

  const byBucket = await db.chartOfAccount.findFirst({
    where: { agencyBucket: bucket, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true },
  })
  return byBucket?.id ?? null
}
