/**
 * scripts/audit-test-data.ts
 *
 * Reads all major tables and identifies records that match known test-data
 * patterns.  Does NOT mutate anything.  Writes audit_candidates.json.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { prisma } from '../lib/db'
import * as fs from 'fs'
import * as path from 'path'

// ── Known test-data name patterns ──────────────────────────────────────────
const TEST_PATTERNS = [
  'test',
  'fifo test',
  'sn-lockdown',
  'sn-cross',
  'sn-p1',
  'sn-p2',
  'sn-p3',
  'sn-adj_',
  'test system admin',
  'phase15',
  'phase 15',
]

function matchesTestPattern(value: string | null | undefined): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  return TEST_PATTERNS.some(p => lower.includes(p))
}

// ── Timestamp-suffix pattern  e.g. "Some Name 1723539000" ─────────────────
const TIMESTAMP_SUFFIX_RE = /\b1[67]\d{9,}\b/   // Unix timestamps in the range 1e10+

function hasTimestampSuffix(value: string | null | undefined): boolean {
  if (!value) return false
  return TIMESTAMP_SUFFIX_RE.test(value)
}

function isSuspect(value: string | null | undefined): boolean {
  return matchesTestPattern(value) || hasTimestampSuffix(value)
}

// ── Main audit ──────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍  Scanning database for test/dummy candidates …\n')

  // ── 1. Customers ────────────────────────────────────────────────────────
  const allCustomers = await prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      outstandingBalance: true,
      createdAt: true,
      sales:        { select: { id: true, saleNumber: true, total: true, createdAt: true } },
      ledgerEntries: { select: { id: true, type: true, amount: true, description: true } },
      serviceJobs:  { select: { id: true, jobNumber: true } },
    },
  })
  const suspectCustomers = allCustomers.filter(c => isSuspect(c.name) || isSuspect(c.phone) || isSuspect(c.email))

  // ── 2. Suppliers ────────────────────────────────────────────────────────
  const allSuppliers = await prisma.supplier.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      outstandingBalance: true,
      createdAt: true,
      purchaseOrders: { select: { id: true, poNumber: true, total: true, status: true, createdAt: true } },
      purchaseInvoices: { select: { id: true, invoiceNumber: true, total: true } },
      ledgerEntries: { select: { id: true, type: true, amount: true } },
    },
  })
  const suspectSuppliers = allSuppliers.filter(s => isSuspect(s.name) || isSuspect(s.phone))

  // ── 3. Products ─────────────────────────────────────────────────────────
  const allProducts = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      productCode: true,
      costPrice: true,
      sellingPrice: true,
      createdAt: true,
      purchaseOrderLines: { select: { id: true } },
      saleLines:          { select: { id: true } },
      serialUnits:        { select: { id: true, serialNumber: true, status: true } },
    },
  })
  const suspectProducts = allProducts.filter(p => isSuspect(p.name) || isSuspect(p.productCode))

  // ── 4. SerialUnits ──────────────────────────────────────────────────────
  const allSerials = await prisma.serialUnit.findMany({
    select: {
      id: true,
      serialNumber: true,
      status: true,
      notes: true,
      createdAt: true,
      product: { select: { id: true, name: true } },
      saleLineSerials: { select: { id: true, saleLine: { select: { sale: { select: { saleNumber: true } } } } } },
      poLineSerials:   { select: { id: true, poLine: { select: { po: { select: { poNumber: true } } } } } },
    },
  })
  const suspectSerials = allSerials.filter(s =>
    isSuspect(s.serialNumber) || isSuspect(s.notes)
  )

  // ── 5. Sales ────────────────────────────────────────────────────────────
  const allSales = await prisma.sale.findMany({
    select: {
      id: true,
      saleNumber: true,
      notes: true,
      total: true,
      createdAt: true,
      customer: { select: { id: true, name: true } },
      cashier:  { select: { id: true, name: true, email: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          product: { select: { name: true } },
          serials: { select: { serialUnit: { select: { serialNumber: true } } } },
        },
      },
      payments: { select: { method: true, amount: true } },
    },
  })
  // A sale is suspect if its notes, saleNumber, or associated customer name matches patterns
  const suspectSales = allSales.filter(s =>
    isSuspect(s.saleNumber) ||
    isSuspect(s.notes) ||
    isSuspect(s.customer?.name) ||
    // If every serial on every line is a test serial pattern, likely test sale
    (s.lines.length > 0 && s.lines.every(l =>
      l.serials.length > 0 && l.serials.every(sl => isSuspect(sl.serialUnit.serialNumber))
    ))
  )

  // ── 6. Purchase Orders ──────────────────────────────────────────────────
  const allPOs = await prisma.purchaseOrder.findMany({
    select: {
      id: true,
      poNumber: true,
      notes: true,
      status: true,
      total: true,
      createdAt: true,
      supplier: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          unitCost: true,
          product: { select: { name: true } },
          serialUnits: { select: { serialUnit: { select: { serialNumber: true } } } },
        },
      },
      purchaseInvoices: { select: { id: true, invoiceNumber: true } },
    },
  })
  const suspectPOs = allPOs.filter(po =>
    isSuspect(po.poNumber) ||
    isSuspect(po.notes) ||
    isSuspect(po.supplier?.name) ||
    (po.lines.length > 0 && po.lines.every(l =>
      l.serialUnits.length > 0 && l.serialUnits.every(su => isSuspect(su.serialUnit.serialNumber))
    ))
  )

  // ── 7. ServiceJobs ──────────────────────────────────────────────────────
  const allServiceJobs = await prisma.serviceJob.findMany({
    select: {
      id: true,
      jobNumber: true,
      device: true,
      issue: true,
      createdAt: true,
      customer: { select: { id: true, name: true } },
    },
  })
  const suspectServiceJobs = allServiceJobs.filter(j =>
    isSuspect(j.device) || isSuspect(j.issue) || isSuspect(j.customer?.name)
  )

  // ── 8. Employees ────────────────────────────────────────────────────────
  const allEmployees = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      employeeCode: true,
      email: true,
      createdAt: true,
      attendances:   { select: { id: true } },
      payrollEntries: { select: { id: true } },
    },
  })
  const suspectEmployees = allEmployees.filter(e => isSuspect(e.name) || isSuspect(e.email))

  // ── 9. BankAccounts ─────────────────────────────────────────────────────
  const allBankAccounts = await prisma.bankAccount.findMany({
    select: {
      id: true,
      bankName: true,
      accountName: true,
      accountNumber: true,
      currentBalance: true,
      createdAt: true,
      transactions:     { select: { id: true } },
      capitalInjections: { select: { id: true } },
    },
  })
  const suspectBankAccounts = allBankAccounts.filter(b =>
    isSuspect(b.bankName) || isSuspect(b.accountName) || isSuspect(b.accountNumber)
  )

  // ── 10. CapitalInjections ───────────────────────────────────────────────
  const allCapInjections = await prisma.capitalInjection.findMany({
    select: {
      id: true,
      amount: true,
      description: true,
      notes: true,
      status: true,
      injectionDate: true,
      createdAt: true,
      bankAccount: { select: { id: true, accountName: true, bankName: true } },
      createdBy:   { select: { id: true, name: true, email: true } },
    },
  })
  const suspectCapInjections = allCapInjections.filter(ci =>
    isSuspect(ci.description) || isSuspect(ci.notes) || isSuspect(ci.createdBy?.name)
  )

  // ── Users ────────────────────────────────────────────────────────────────
  const allUsers = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      sales:                  { select: { id: true, saleNumber: true } },
      purchaseOrdersCreated:  { select: { id: true, poNumber: true } },
    },
  })
  const suspectUsers = allUsers.filter(u => isSuspect(u.name) || isSuspect(u.email))

  // ── Build report ─────────────────────────────────────────────────────────
  const report = {
    _meta: {
      generatedAt: new Date().toISOString(),
      backupFile: 'backups/backup_2026-08-13T07-29-25-353Z.json  (SQL + JSON — 1007 rows, 81 tables)',
    },
    summary: {
      customers:        { total: allCustomers.length,    suspects: suspectCustomers.length },
      suppliers:        { total: allSuppliers.length,    suspects: suspectSuppliers.length },
      products:         { total: allProducts.length,     suspects: suspectProducts.length },
      serialUnits:      { total: allSerials.length,      suspects: suspectSerials.length },
      sales:            { total: allSales.length,        suspects: suspectSales.length },
      purchaseOrders:   { total: allPOs.length,          suspects: suspectPOs.length },
      serviceJobs:      { total: allServiceJobs.length,  suspects: suspectServiceJobs.length },
      employees:        { total: allEmployees.length,    suspects: suspectEmployees.length },
      bankAccounts:     { total: allBankAccounts.length, suspects: suspectBankAccounts.length },
      capitalInjections: { total: allCapInjections.length, suspects: suspectCapInjections.length },
      users:            { total: allUsers.length,        suspects: suspectUsers.length },
    },
    candidates: {
      customers:        suspectCustomers,
      suppliers:        suspectSuppliers,
      products:         suspectProducts,
      serialUnits:      suspectSerials,
      sales:            suspectSales,
      purchaseOrders:   suspectPOs,
      serviceJobs:      suspectServiceJobs,
      employees:        suspectEmployees,
      bankAccounts:     suspectBankAccounts,
      capitalInjections: suspectCapInjections,
      users:            suspectUsers,
    },
    allRecords: {
      customers:  allCustomers,
      suppliers:  allSuppliers,
      sales:      allSales,
      purchaseOrders: allPOs,
      users:      allUsers,
    },
  }

  const outPath = path.join(process.cwd(), 'audit_candidates.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8')

  console.log('========================================')
  console.log('✅  Audit complete — candidates written to:')
  console.log('   ', outPath)
  console.log('----------------------------------------')
  console.log('TOTALS vs SUSPECTS:')
  for (const [table, counts] of Object.entries(report.summary)) {
    const { total, suspects } = counts as { total: number; suspects: number }
    const flag = suspects > 0 ? '⚠️ ' : '✓ '
    console.log(`  ${flag} ${table.padEnd(20)} ${suspects}/${total} suspects`)
  }
  console.log('========================================\n')
}

main()
  .catch(err => { console.error('Audit failed:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
