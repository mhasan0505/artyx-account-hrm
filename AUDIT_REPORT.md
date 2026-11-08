# Comprehensive End-to-End Architecture, Financial, Database & Security Audit Report

**Project:** Tech Drive POS & ERP (`account-tech-drive`)  
**Stack:** Next.js 16.1.6 (App Router / React 19), PostgreSQL, Prisma 7.4.2 (`@prisma/adapter-pg`), NextAuth v5 (beta.30), Zustand, Tailwind CSS v4  
**Audit Role:** Principal Full-Stack Architect, Database Engineer & QA Security Auditor  
**Remediation Status:** ✅ **ALL 28 FINDINGS RESOLVED & TYPECHECK-VERIFIED**

---

## 0. Remediation Resolution Checklist

### Critical & High-Severity Bugs (`CRIT-01` – `CRIT-16`)
- [x] **RESOLVED — `CRIT-01`:** Complimentary Gift `StockLayer` Permanent Leak on Sale Deletion (`deleteSale`) and Terminal Re-Checkout (`resubmitSaleEdit`) (`lib/actions/sales.ts`)
- [x] **RESOLVED — `CRIT-02`:** `resubmitSaleEdit` Deletes `DrawerTransaction` Rows from Closed Drawers, Lacks `FOR UPDATE` on `StockLayer`, and Resets Backdated `Sale.createdAt` (`lib/actions/sales.ts`)
- [x] **RESOLVED — `CRIT-03`:** `updateSaleItems` Omits Serial Count/Product Validation, Ignores Serial-Specific COGS, and Overcharges Cash Drawer When `changeDue > 0` (`lib/actions/sales.ts`)
- [x] **RESOLVED — `CRIT-04`:** `recordSupplierPaymentAction` Fails to Post Any General Ledger (`AccountLedgerEntry`) Entries (`lib/actions/ap-ar.ts`)
- [x] **RESOLVED — `CRIT-05`:** `receivePaymentFromCustomer` Credits Bank (`1200`) Instead of Accounts Receivable (`1300`) and Leaves Open Invoices Unallocated (`lib/actions/crm.ts`)
- [x] **RESOLVED — `CRIT-06`:** `createServiceInvoice` and `collectServicePayment` Crash with `UNBALANCED_JOURNAL` Whenever Non-Cash `feeAmount > 0` (`lib/actions/service.ts`)
- [x] **RESOLVED — `CRIT-07`:** Multi-Shift Same-Day Cash Drawers Break `resolveDrawerSessionForDate`, Causing Z-Report Blindspots and Daily Cash Report Double-Counting (`lib/actions/drawer-session-utils.ts`, `lib/actions/cash-report.ts`, `lib/actions/z-report.ts`)
- [x] **RESOLVED — `CRIT-08`:** `convertQuotationToSale` Drops Line-Level `discountAmt` and Double-Counts It Inside Order-Level `discountPct` (`lib/actions/sales.ts`)
- [x] **RESOLVED — `CRIT-09`:** `PurchaseOrder` Line Discounts Are Deducted from GL Inventory (`1400`) but Ignored in `StockLayer.unitCost`, `SerialUnit.costPrice`, `Product.costPrice`, and Purchase Returns (`lib/actions/purchases.ts`)
- [x] **RESOLVED — `CRIT-10`:** B2B Actions Corrupt `Supplier.outstandingBalance` vs `Customer.outstandingBalance` and Omit MFS Fee Deductions on `BankAccount.currentBalance` (`lib/actions/b2b.ts`)
- [x] **RESOLVED — `CRIT-11`:** `updateInventorySerialStatus` Omits GL Entries on Write-Off/Recovery, and `confirmStockTransfer` Overwrites Destination FIFO `StockLayer.unitCost` with Catalog `Product.costPrice` (`lib/actions/products.ts`)
- [x] **RESOLVED — `CRIT-12`:** `createBankTransaction` Hardcodes Cash in Hand (`1100`) as Counter-Account Without Updating `CashDrawer` (`lib/actions/bank.ts`)
- [x] **RESOLVED — `CRIT-13`:** Missing RBAC & Multi-Outlet Isolation (`validateOutletAccess`) Across API Routes and Server Actions (`app/api/products/[id]/route.ts`, `app/api/products/export/route.ts`, `lib/actions/purchases.ts`, `lib/actions/sales.ts`, `lib/actions/internal-repair.ts`, `lib/actions/payroll.ts`)
- [x] **RESOLVED — `CRIT-14`:** `CheckoutDialog` Hardcodes `taxAmt = 0`, Displays Wrong Banner Total When Line Discounts or Customer Fees Exist, and Allows Order Discount > `netSubtotal` (`components/sales-terminal/checkout-dialog.tsx`)
- [x] **RESOLVED — `CRIT-15`:** `getBankAccountStatement` Historical Opening Balance Ignores Active Date/Type/Search Filters (`lib/actions/bank.ts`)
- [x] **RESOLVED — `CRIT-16`:** `ProductBrowser` Client State Never Refreshes After Checkout, Leaving Stale Stock & Sold Serials in the POS Catalog (`components/sales-terminal/product-browser.tsx`, `components/sales-terminal/index.tsx`)

### Medium-Severity Bugs & Schema/Performance Issues (`MED-01` – `MED-08`)
- [x] **RESOLVED — `MED-01`:** `AccountLedgerEntry` Lacks `outletId` Column & Foreign Key Relation (`prisma/schema.prisma`)
- [x] **RESOLVED — `MED-02`:** Dangerous `onDelete: Cascade` / Non-Explicit Restrict Rules on Financial & Audit Relations (`prisma/schema.prisma`)
- [x] **RESOLVED — `MED-03`:** Missing Composite Database Indexes on High-Frequency Lookup Columns (`prisma/schema.prisma`)
- [x] **RESOLVED — `MED-04`:** N+1 Query Pattern Inside `executeFixedAssetDepreciation` Transaction Loop (`lib/actions/fixed-assets.ts`)
- [x] **RESOLVED — `MED-05`:** `createSaleReturn` Partial Return Rounding Drift & Tax Payable (`2300`/`2200`) Fallback (`lib/actions/sales.ts`)
- [x] **RESOLVED — `MED-06`:** `CustomerSearch` Drops `groupName` and `groupDiscountPct` on Cart Rehydration (`lib/actions/crm.ts`, `components/sales-terminal/customer-search.tsx`)
- [x] **RESOLVED — `MED-07`:** Incrementing Serialized Item Quantity Resets Custom `unitPrice` to Catalog Price (`components/sales-terminal/index.tsx`, `lib/stores/pos-cart.ts`)
- [x] **RESOLVED — `MED-08`:** Excel Product Export Hardcodes `"$"` Currency Format Instead of `"৳"` (`app/api/products/export/route.ts`)

### UI/UX, POS Ergonomics & Print Layout Issues (`UI-01` – `UI-04`)
- [x] **RESOLVED — `UI-01`:** `A4Invoice` (`SalesInvoiceLayout`) Omits `Discount` and `Grand Total` Rows in `tfoot` (`components/receipt/a4-invoice.tsx`)
- [x] **RESOLVED — `UI-02`:** `ThermalReceipt` Omits `.thermal-receipt` Print Class, Serial Numbers/Warranty Expiry, and Paid/Balance Due Rows (`components/receipt/thermal-receipt.tsx`)
- [x] **RESOLVED — `UI-03`:** POS Terminal Ergonomics: Unconditional `Esc` Cart Clear, Missing `F3`/`F8` Hotkeys, `Enter` in `SerialSlotPicker`, and Auto-Focus in `CheckoutDialog` (`components/sales-terminal/index.tsx`, `components/sales-terminal/active-cart.tsx`, `components/sales-terminal/checkout-dialog.tsx`)
- [x] **RESOLVED — `UI-04`:** Missing Stock Badge in `ProductBrowser` List View, Customer Group Badge in `CustomerSearch`, and Decimal Precision Alignment in P&L Report (`components/sales-terminal/product-browser.tsx`, `components/sales-terminal/customer-search.tsx`, `app/(app)/reports/profit-loss/page.tsx`)

---

## 1. Executive Summary

### Overall Health Score: **68 / 100**

| Audit Pillar | Score | Status | Key Observations |
| :--- | :---: | :---: | :--- |
| **1. Database Schema, Queries & ACID Integrity** | **76 / 100** | 🟡 Moderate Risk | Zero `Float`/`Double` columns in `prisma/schema.prisma` (all monetary fields use `@db.Decimal(10,2)` or `@db.Decimal(12,2)`). Core `checkout()` uses `prisma.$transaction` with `FOR UPDATE` row locks on `Product`, `SerialUnit`, `StockLayer`, `CashDrawer`, and `BankAccount`. However, `resubmitSaleEdit` omits `FOR UPDATE` on `StockLayer` and bypasses closed-drawer guards; `AccountLedgerEntry` lacks an `outletId` foreign key; and several `onDelete: Cascade` rules and missing composite indexes create operational and performance risks. |
| **2. Financial Calculations & Business Logic** | **58 / 100** | 🔴 Critical Risk | Multiple high-impact accounting and inventory valuation bugs: gift `StockLayer` leaks on sale deletion/edit; `recordSupplierPaymentAction` omits General Ledger entries completely; `receivePaymentFromCustomer` credits Bank (`1200`) instead of Accounts Receivable (`1300`); `createServiceInvoice` and `collectServicePayment` crash with `UNBALANCED_JOURNAL` whenever `feeAmount > 0`; `convertQuotationToSale` double-counts line discounts; `PurchaseOrder` line discounts are ignored in `StockLayer`/`SerialUnit` cost basis; and multi-shift same-day cash drawers cause Z-Report discrepancies and Daily Cash Report double-counting. |
| **3. Next.js Architecture, Caching & Security** | **68 / 100** | 🟠 High Risk | `requireAuth()` re-verifies live DB user status/role and `proxy.ts` enforces route prefixes, but API routes `/api/products/[id]` (`DELETE`/`PATCH`) and `/api/products/export` lack RBAC checks (allowing cashiers to archive stocked products or export unit cost prices for 1M items). Several server actions (`getPurchaseInvoiceById`, `updatePurchaseInvoiceNotes`, `getSaleEditLogs`, `getSaleReturnPreview`, `dispatchInternalRepair`, `getPayrollPeriodById`) lack `validateOutletAccess` (multi-outlet IDOR). Positively, `ProductBrowser` holds products in client state without re-fetching after checkout, displaying stale stock in the POS terminal. |
| **4. UI/UX, POS Ergonomics & Print Layouts** | **70 / 100** | 🟡 Moderate Risk | Strong keyboard shortcut support (`F2`, `Ctrl+K`, `F12`, `Esc`), idempotency keys on `checkout()`, and offline queue locking (`navigator.locks`). However, `CheckoutDialog`'s main 6xl total banner omits line discounts and customer MFS fees; `CheckoutDialog` hardcodes `taxAmt = 0` while `ActiveCart` and server `checkout()` apply `default_tax_rate`; `A4Invoice` (`SALES INVOICE` layout) omits `Discount` and `Grand Total` rows in `tfoot`; and `ThermalReceipt` omits serial numbers, warranty dates, and balance due, and mismatches `#thermal-receipt` vs `.thermal-receipt` in `app/globals.css`. |

---

### End-to-End Data Flow Trace Summary

```
[Purchase Order / Direct Purchase / B2B Purchase]
   ├─► StockLayer (FIFO batch) + SerialUnit (IN_STOCK) + StockLedger (PURCHASE_IN)
   ├─► PurchaseInvoice + Supplier.outstandingBalance + GL (Dr 1400 Inventory, Cr 2100 AP / 1100 Cash / 1200 Bank)
   │     ⚠️ BUG: PO line discounts deducted from GL 1400 but ignored in StockLayer.unitCost & SerialUnit.costPrice
   ▼
[POS Terminal: ProductBrowser -> PosCartStore -> ActiveCart -> CheckoutDialog]
   ├─► checkout() (lib/actions/sales.ts) inside prisma.$transaction
   ├─► Locks Product, SerialUnit, StockLayer (FOR UPDATE), consumes FIFO layers (including complimentary gifts)
   ├─► Creates Sale, SaleLine, SaleLineSerial, SalePayment, DrawerTransaction, BankTransaction
   ├─► Posts balanced GL (Dr 1100/1200/1300/5290/5291, Cr 4100/2200, Dr 5100 COGS / Cr 1400 Inventory)
   │     ⚠️ BUG: ProductBrowser client state never refreshes after checkout -> stale stock shown for next sale
   │     ⚠️ BUG: CheckoutDialog hardcodes taxAmt = 0 & 6xl banner ignores lineDiscountsTotal + customerFees
   ▼
[Post-Sale Mutations: Return / Edit / Delete / Due Collection]
   ├─► createSaleReturn(): Restores StockLayer, SerialUnit, StockLedger (RETURN_IN), reverses GL & Drawer/Bank/StoreCredit
   ├─► deleteSale() & resubmitSaleEdit():
   │     ⚠️ BUG: Skips StockLayer restoration for gift lines (if (!oldLine.isGift)) -> permanent FIFO layer leak!
   │     ⚠️ BUG: resubmitSaleEdit deletes DrawerTransaction from CLOSED drawers & lacks FOR UPDATE on StockLayer
   ├─► updateSaleItems():
   │     ⚠️ BUG: Missing serial count/product match check, uses FIFO cost instead of serial.costPrice, overcharges CashDrawer by changeDue
   ▼
[Financial & Shift Reports: Z-Report, Daily Cash Report, P&L, Balance Sheet]
   ├─► resolveDrawerSessionForDate() picks only latest drawer -> multi-shift same-day blindspot & double-counting
   ├─► AccountLedgerEntry lacks outletId -> outlet P&L / Cash Flow GL cross-checks compare 1 outlet vs global GL
```

---

## 2. Critical & High-Severity Bugs (Fix Immediately)

### CRIT-01: Complimentary Gift `StockLayer` Permanent Leak on Sale Deletion (`deleteSale`) and Terminal Re-Checkout (`resubmitSaleEdit`)
- **Severity:** 🔴 Critical (Inventory Valuation & Checkout Crash `FIFO_LAYER_DEFICIT`)
- **Locations:**
  - `lib/actions/sales.ts:1147-1208` (`checkout` — consumes `StockLayer` for all lines including `isGift: true`)
  - `lib/actions/sales.ts:5443-5467` (`deleteSale` — skips `StockLayer` restoration when `oldLine.isGift === true`)
  - `lib/actions/sales.ts:5777-5796` (`resubmitSaleEdit` — skips `StockLayer` restoration when `oldLine.isGift === true`)

#### Flawed Code (`lib/actions/sales.ts:5441-5474` and `lib/actions/sales.ts:5775-5803`):
```ts
// Inside deleteSale (lines 5441-5474):
// 2. Restore FIFO StockLayers for each line
for (const oldLine of oldSale.lines) {
  if (!oldLine.isGift) { // ❌ BUG: checkout() consumed StockLayer even when isGift === true!
    let remainingToRestore = oldLine.quantity
    const layers = await tx.$queryRaw<Array<{ id: string; quantity: number; quantityRemaining: number }>>`
      SELECT id, quantity, "quantityRemaining"
      FROM "StockLayer"
      WHERE "productId" = ${oldLine.productId} AND "outletId" = ${oldSale.outletId}
      ORDER BY "createdAt" DESC
      FOR UPDATE
    `
    // ... restores layers ...
  }
}
// 3. Delete SALE_OUT StockLedger entries (restores available stock aggregation)
await tx.stockLedger.deleteMany({
  where: { referenceId: saleId, movementType: StockMovementType.SALE_OUT }, // Deletes gift StockLedger too!
})
```
- **Why It Breaks:** During `checkout()` (`lib/actions/sales.ts:1147-1208`), complimentary gift lines (`isGift: true`) consume `StockLayer.quantityRemaining` via `consumeStockLayersFIFO` AND create `StockLedger` `SALE_OUT` entries AND post COGS (`Dr 5100 / Cr 1400`). When `deleteSale` or `resubmitSaleEdit` runs, it deletes all `StockLedger` `SALE_OUT` rows (restoring aggregated stock) and deletes the GL entries (restoring `GL 1400`), **but skips restoring `StockLayer.quantityRemaining` for gift items**. Every deleted or edited laptop sale with a complimentary gift permanently leaks 1 unit of `StockLayer` capacity per gift. Subsequent sales pass the `StockLedger` stock check and then crash inside `consumeStockLayersFIFO` with `FIFO_LAYER_DEFICIT`.
- **Exact Fix Required:** Remove the `if (!oldLine.isGift)` guard around `StockLayer` restoration in both `deleteSale` (`lib/actions/sales.ts:5443`) and `resubmitSaleEdit` (`lib/actions/sales.ts:5777`) so that every sale line that consumed a `StockLayer` restores its quantity back to the FIFO layers.

---

### CRIT-02: `resubmitSaleEdit` Mutates Closed Cash Drawers, Corrupts Historical `saleDate`, and Lacks `FOR UPDATE` Locking on `StockLayer`
- **Severity:** 🔴 Critical (Cash Drawer Audit Integrity & Race Condition)
- **Locations:** `lib/actions/sales.ts:5694-5832`

#### Flawed Code (`lib/actions/sales.ts:5777-5826`):
```ts
// 2. Restore StockLayer
for (const oldLine of oldSale.lines) {
  if (!oldLine.isGift) {
    let remaining = oldLine.quantity
    // ❌ BUG 1: No FOR UPDATE row lock and non-atomic quantityRemaining + restore
    const layers = await tx.stockLayer.findMany({
      where: { productId: oldLine.productId, outletId: oldSale.outletId },
      orderBy: { createdAt: 'desc' },
    })
    for (const layer of layers) {
      if (remaining <= 0) break
      const cap = layer.quantity - layer.quantityRemaining
      if (cap > 0) {
        const restore = Math.min(remaining, cap)
        await tx.stockLayer.update({
          where: { id: layer.id },
          data: { quantityRemaining: layer.quantityRemaining + restore },
        })
        remaining -= restore
      }
    }
  }
}
// ...
// 6. Delete DrawerTransaction & AccountLedgerEntry
// ❌ BUG 2: No check for closed CashDrawer (SAL-008) before deleting DrawerTransaction!
await tx.drawerTransaction.deleteMany({
  where: { referenceId: originalSaleId, referenceType: 'Sale' },
})
```
- **Why It Breaks:**
  1. Unlike `updateSaleItems` (`lib/actions/sales.ts:4420-4435`) and `deleteSale` (`lib/actions/sales.ts:5363-5377`), `resubmitSaleEdit` never checks whether `oldSale`'s `DrawerTransaction` belongs to a `CLOSED` `CashDrawer`. Editing a prior shift's cash sale silently deletes the `DrawerTransaction` from the historical closed drawer and posts the replacement sale's cash into today's currently open drawer.
  2. `resubmitSaleEdit` uses `tx.stockLayer.findMany` without `FOR UPDATE` and writes `quantityRemaining: layer.quantityRemaining + restore` instead of `{ increment: restore }`, risking lost updates under concurrent checkouts.
  3. At `lib/actions/sales.ts:5835-5849`, `resubmitSaleEdit` calls `checkout({ ...checkoutInput })` where `CheckoutDialog` (`components/sales-terminal/checkout-dialog.tsx:145, 466`) defaults `saleDate` to `new Date()` (current timestamp) instead of preserving `oldSale.createdAt`, silently moving historical invoices into today's date unless the user manually re-picks the original timestamp.
- **Exact Fix Required:**
  1. Add the `SAL-008` closed-drawer guard (`tx.drawerTransaction.findMany` with `include: { drawer: { select: { status: true } } }`) before allowing `resubmitSaleEdit`.
  2. Replace `tx.stockLayer.findMany` in `resubmitSaleEdit` with `SELECT id, quantity, "quantityRemaining" FROM "StockLayer" ... FOR UPDATE` and `{ increment: restore }` (matching `deleteSale` at `lib/actions/sales.ts:5445-5462`), and handle overflow when `remaining > 0`.
  3. Default `saleDate` in `resubmitSaleEdit` to `oldSale.createdAt` when `input.saleDate` is not explicitly overridden.

---

### CRIT-03: `updateSaleItems` Missing Serial Validation, Cross-Product Serial Hijack, Wrong COGS Basis, and Cash Drawer Overcharge (`changeDue` Omitted)
- **Severity:** 🔴 Critical (Inventory Corruption, COGS Misstatement & Cash Drawer Overstatement)
- **Locations:** `lib/actions/sales.ts:4730-4820` and `lib/actions/sales.ts:5013-5056`

#### Flawed Code (`lib/actions/sales.ts:4775-4802` and `lib/actions/sales.ts:5020-5055`):
```ts
// 1. Missing serial count check, productId match check, serial costPrice COGS, and warrantyExpiry:
if (line.serialNumbers.length > 0) {
  for (const sn of line.serialNumbers) {
    const trimmed = sn.trim()
    if (!trimmed) continue
    // ❌ BUG 1: Queries by { serialNumber: trimmed, outletId } WITHOUT checking productId === line.productId!
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM "SerialUnit"
      WHERE "serialNumber" = ${trimmed} AND "outletId" = ${oldSale.outletId}
      FOR UPDATE
    `
    const serial = rows[0]
    if (!serial) throw new Error(`Serial number "${trimmed}" not found in this outlet`)
    if (serial.status !== 'IN_STOCK') {
      throw new Error(`Serial number "${trimmed}" is not available (status: ${serial.status})`)
    }
    await tx.serialUnit.update({
      where: { id: serial.id },
      data: { status: 'SOLD' }, // ❌ BUG 2: Does not set warrantyExpiry!
    })
    await tx.saleLineSerial.create({
      data: { saleLineId: createdLine.id, serialUnitId: serial.id },
    })
  }
}

// 2. Cash Drawer Overcharge when changeDue > 0 (lines 5020-5055):
if (np.method === PaymentMethod.CASH) {
  if (openDrawer) {
    await tx.drawerTransaction.create({
      data: {
        drawerId: openDrawer.id,
        type: DRAWER_TX_TYPE.SALE_CASH_IN,
        amount: np.amount, // ❌ BUG 3: Records gross cash tendered without subtracting changeDue!
        description: `Cash payment for edited sale ${oldSale.saleNumber}`,
        referenceId: saleId,
        referenceType: 'Sale',
      },
    })
  }
  const cashAccId = coaMap.get('1100')
  if (cashAccId) {
    const netCashAmount = round2(np.amount - Number(oldSale.changeDue || 0)) // GL subtracts oldSale.changeDue!
```
- **Why It Breaks:**
  1. `updateSaleItems` never verifies that `product.requiresSerial` lines provide `line.serialNumbers.length === line.quantity`, nor does it check `serial.productId === line.productId`. A serial belonging to Product B can be attached to a line for Product A.
  2. For serialized products, `checkout()` (`lib/actions/sales.ts:1181`) uses the specific `serial.costPrice` for `SaleLine.costPrice` and `totalCogs`, whereas `updateSaleItems()` (`lib/actions/sales.ts:4739-4745`) uses FIFO `StockLayer` batch cost.
  3. At `lib/actions/sales.ts:4809-4820`, `updateSaleItems` updates `Sale.total` and `Sale.amountPaid` without recalculating `Sale.changeDue`. Then at `lib/actions/sales.ts:5024`, it posts `amount: np.amount` (gross cash tendered) to `DrawerTransaction` while debiting `GL 1100 Cash` by `np.amount - oldSale.changeDue`, immediately desynchronizing `CashDrawer` from `GL 1100`.
- **Exact Fix Required:**
  1. Enforce `requiresSerial` count/uniqueness and `serial.productId === line.productId` in `updateSaleItems`, compute `warrantyExpiry` from `product.warrantyMonths`, and use `serial.costPrice` for serialized line COGS.
  2. Recalculate `newChangeDue = round2(Math.max(0, cashTendered - requiredFromCash))` in `updateSaleItems`, update `Sale.changeDue = newChangeDue`, and post `netCashAmount = round2(np.amount - newChangeDue)` to both `DrawerTransaction` and `GL 1100`.

---

### CRIT-04: `recordSupplierPaymentAction` Completely Omits General Ledger (`AccountLedgerEntry`) Posting
- **Severity:** 🔴 Critical (Trial Balance, Balance Sheet & Cash Flow Corruption)
- **Location:** `lib/actions/ap-ar.ts:690-898`

#### Flawed Code (`lib/actions/ap-ar.ts:806-885`):
```ts
// 5. Deduct from CashDrawer or BankAccount
if (input.paymentMethod === 'CASH') {
  const openDrawer = await tx.cashDrawer.findFirst({ ... })
  // ... creates tx.drawerTransaction.create({ type: DRAWER_TX_TYPE.EXPENSE_OUT, amount: paymentAmount })
} else {
  // ... decrements tx.bankAccount.update({ currentBalance: { decrement: paymentAmount } })
  // ... creates tx.bankTransaction.create({ type: 'WITHDRAWAL', amount: paymentAmount })
}
// 6. Create SupplierPayment record(s)
// ...
// 7. Decrement Supplier.outstandingBalance
await tx.supplier.update({
  where: { id: supplier.id },
  data: { outstandingBalance: { decrement: paymentAmount } },
})
// ❌ BUG: Zero AccountLedgerEntry rows created! Neither Dr 2100 (AP) nor Cr 1100 (Cash) / Cr 1200 (Bank) is posted!
```
- **Why It Breaks:** Compare `recordSupplierPaymentAction` (`lib/actions/ap-ar.ts:690-898`) with `recordCustomerCollectionAction` in the same file (`lib/actions/ap-ar.ts:1087-1135`) or `payPurchaseInvoice` (`lib/actions/b2b.ts:2920-2960`). When paying a supplier via the AP/AR Hub:
  - `Supplier.outstandingBalance` decreases, `PurchaseInvoice.amountPaid` increases, and `CashDrawer` / `BankAccount.currentBalance` decreases.
  - **Zero `AccountLedgerEntry` rows are created.** `GL 2100 Accounts Payable` remains permanently overstated, and `GL 1100 Cash` / `GL 1200 Bank` remain permanently overstated.
- **Exact Fix Required:** Inside `recordSupplierPaymentAction`'s transaction (`lib/actions/ap-ar.ts:880`), resolve CoA accounts `2100` (Accounts Payable) and `1100` (Cash in Hand) / `1200` (Bank Accounts), construct `[ { accountId: apAccId, type: DEBIT, amount: paymentAmount }, { accountId: cashOrBankAccId, type: CREDIT, amount: paymentAmount } ]`, call `assertBalancedJournal(glEntries)`, and insert via `tx.accountLedgerEntry.createMany({ data: glEntries })`.

---

### CRIT-05: `receivePaymentFromCustomer` Credits Bank (`1200`) Instead of Accounts Receivable (`1300`) and Never Settles Open `Sale` Invoices
- **Severity:** 🔴 Critical (General Ledger Corruption & Subledger Desynchronization)
- **Location:** `lib/actions/crm.ts:350-469`

#### Flawed Code (`lib/actions/crm.ts:432-468`):
```ts
const coaAccounts = await tx.chartOfAccount.findMany({
  where: { code: { in: ['1100', '1110', '1200'] } }, // ❌ BUG 1: Missing '1300' (Accounts Receivable)!
})
const coaMap = new Map(coaAccounts.map(a => [a.code, a.id]))
const cashAccId = coaMap.get('1100')
const bankAccId = coaMap.get('1110') // ❌ BUG 2: Bank is '1200', not '1110'!
const arAccId = coaMap.get('1200')   // ❌ BUG 3: Maps '1200' (Bank Accounts) as arAccId!

const debitAccId = method === 'CASH' ? cashAccId : bankAccId
if (debitAccId && arAccId) {
  const paymentGlEntries = [
    {
      accountId: debitAccId,
      type: TransactionType.DEBIT,
      amount,
      description: `Payment received from customer (${method})`,
      referenceId: customerId,
      referenceType: 'CustomerPayment',
    },
    {
      accountId: arAccId, // ❌ Credits 1200 (Bank Accounts) instead of 1300 (Accounts Receivable)!
      type: TransactionType.CREDIT,
      amount,
      description: `AR reduction for customer payment`,
      referenceId: customerId,
      referenceType: 'CustomerPayment',
    },
  ]
```
- **Why It Breaks:**
  1. In the Chart of Accounts (`lib/actions/sales.ts:1032`, `lib/actions/ap-ar.ts:1091`), `1100` is Cash in Hand, `1200` is Bank Accounts, and `1300` is Accounts Receivable. `receivePaymentFromCustomer` maps `arAccId = coaMap.get('1200')` and `bankAccId = coaMap.get('1110')` (which doesn't exist!).
  2. When a customer pays in `CASH`, `receivePaymentFromCustomer` **debits `1100 Cash` and credits `1200 Bank Accounts`**! When a customer pays via `BANK`, `bankAccId` (`1110`) is `undefined`, so **no GL entry is posted at all**!
  3. Unlike `recordCustomerCollectionAction` (`lib/actions/ap-ar.ts:904-1161`), `receivePaymentFromCustomer` does not lock the `Customer` row with `FOR UPDATE`, does not guard against overpayment (`amount > customer.creditBalance`), and **never updates `Sale.amountPaid` or `ServiceInvoice.amountPaid`**, leaving all invoices permanently unpaid in `getDueReport` and `getApArOverview`.
- **Exact Fix Required:** Delegate `receivePaymentFromCustomer` directly to `recordCustomerCollectionAction` (`lib/actions/ap-ar.ts:904`), or fix the CoA codes (`bankAccId = coaMap.get('1200')`, `arAccId = coaMap.get('1300')`), lock the customer row `FOR UPDATE`, and allocate the payment FIFO across open `Sale` and `ServiceInvoice` records.

---

### CRIT-06: Unbalanced Journal Crash (`UNBALANCED_JOURNAL`) in `createServiceInvoice` and `collectServicePayment` When `feeAmount > 0`
- **Severity:** 🔴 Critical (100% Transaction Crash on MFS/Card Service Payments with Charges)
- **Locations:** `lib/actions/service.ts:1487-1536` (`createServiceInvoice`) and `lib/actions/service.ts:1785-1830` (`collectServicePayment`)

#### Flawed Code (`lib/actions/service.ts:1512-1535` and `lib/actions/service.ts:1806-1828`):
```ts
// Inside createServiceInvoice (lines 1512-1535):
if (feeAmount > 0) {
  const isMfs = ['BKASH', 'NAGAD', 'ROCKET'].includes(p.method)
  const expCode = isMfs ? '5290' : '5291'
  const expAccId = coaMap.get(expCode)
  if (expAccId) {
    ledgerEntries.push({
      accountId: expAccId,
      type: TransactionType.DEBIT,
      amount: feeAmount,
      description: `${p.method} Charge for Service Invoice ${invoiceNumber}`,
      referenceId: createdInvoice.id,
      referenceType: 'ServiceInvoice',
    })
  }
}
// ...
if (ledgerEntries.length > 0) {
  assertBalancedJournal(ledgerEntries) // ❌ CRASHES with UNBALANCED_JOURNAL: Debits = total + feeAmount, Credits = total!
  await tx.accountLedgerEntry.createMany({ data: ledgerEntries })
}
```
- **Why It Breaks:** Both `createServiceInvoice` and `collectServicePayment` push a `DEBIT` to `5290`/`5291` for `feeAmount`, debit `1200 Bank` by the full `p.amount`, and credit `4200 Service Revenue` / `1300 AR` by `total`. There is **no offsetting `CREDIT` entry for `feeAmount`** (nor is `feeAmount` deducted from `bankAccount.currentBalance`). Consequently, `totalDebits = total + feeAmount` while `totalCredits = total`, causing `assertBalancedJournal(ledgerEntries)` to throw `UNBALANCED_JOURNAL` and roll back every service payment that includes an MFS or card fee.
- **Exact Fix Required:** Match the accounting pattern in `checkout()` (`lib/actions/sales.ts:1062-1122`): for `MERCHANT_BEARS`, increment `bankAccount.currentBalance` by `p.amount - feeAmount` (or record a fee withdrawal) and push a `CREDIT` of `feeAmount` to `1200 Bank` (or debit `1200 Bank` by net `p.amount - feeAmount` and debit `5290/5291` by `feeAmount`).

---

### CRIT-07: Multi-Shift Same-Day Cash Drawer Blindspot in `getZReport` & Double-Counting in `getDailyCashReport`
- **Severity:** 🔴 Critical (Cash Drawer Reconciliation & Z-Report Discrepancy)
- **Locations:**
  - `lib/actions/drawer-session-utils.ts:16-67` (`resolveDrawerSessionForDate`)
  - `lib/actions/z-report.ts:177-218, 300-346` (`getZReport`)
  - `lib/actions/cash-report.ts:154-205` (`getDailyCashReport`)

#### Flawed Code (`lib/actions/cash-report.ts:160-196` and `lib/actions/z-report.ts:185-217`):
```ts
// lib/actions/cash-report.ts:160-196:
const drawerResolution = await resolveDrawerSessionForDate(outletId, start, end)
const mainCashOpening = drawerResolution.openingBalance // ❌ Returns ONLY the latest drawer's openingBalance!

const [todayDrawerInflow, todayDrawerOutflow] = await Promise.all([
  prisma.drawerTransaction.aggregate({
    where: {
      drawer: { outletId }, // ❌ Aggregates across ALL drawers of the outlet for the day!
      createdAt: { gte: start, lte: end },
      type: { in: INFLOW_DRAWER_TYPES },
    },
    _sum: { amount: true },
  }),
  // ...
])
const mainCashClosing = round2(mainCashOpening + totalCashInflow - totalCashOutflow)
```
- **Why It Breaks:**
  1. `resolveDrawerSessionForDate` (`lib/actions/drawer-session-utils.ts:25-34`) queries `prisma.cashDrawer.findFirst({ where: { outletId, openedAt: { gte: startOfDay, lte: endOfDay } }, orderBy: { openedAt: 'desc' } })`.
  2. Suppose Shift 1 opens Drawer A with `৳5,000`, makes `৳10,000` in cash sales, and closes Drawer A at `৳15,000`. Shift 2 opens Drawer B on the same day (`openingBalance = ৳15,000`) and makes `৳8,000` in cash sales (`closing = ৳23,000`).
  3. **In `getDailyCashReport`:** `mainCashOpening` is taken from Drawer B (`৳15,000`), while `todayDrawerInflow` sums `DrawerTransaction` across **both Drawer A and Drawer B** (`৳10,000 + ৳8,000 = ৳18,000`). `mainCashClosing` is computed as `৳15,000 + ৳18,000 = ৳33,000` instead of `৳23,000`—**double-counting Shift 1's `৳10,000` net inflow**!
  4. **In `getZReport`:** `txns` (`lib/actions/z-report.ts:185-188`) filters by `drawerId: drawer.id` (only Drawer B: `৳8,000`), whereas `salePayments` (`lib/actions/z-report.ts:300-306`) sums `SalePayment` across the entire calendar day (`৳18,000`), triggering a false `tenderDiscrepancy` of `৳10,000` (`lib/actions/z-report.ts:339-346`).
- **Exact Fix Required:**
  - In `resolveDrawerSessionForDate` (or a dedicated day-level helper for `getDailyCashReport`), use the **earliest** drawer opened on that calendar day (`orderBy: { openedAt: 'asc' }`) for the day's `mainCashOpening` when aggregating `DrawerTransaction` across all drawers for the day (excluding inter-drawer carryover if Drawer B's opening balance is not a `DrawerTransaction`).
  - In `getZReport`, either scope `salePayments` to the selected `CashDrawer`'s `[openedAt, closedAt ?? end]` window, or aggregate all `CashDrawer` sessions opened on that date.

---

### CRIT-08: `convertQuotationToSale` Double-Counts Line Discounts as Order-Level Discounts & Drops Flat `discountAmt`
- **Severity:** 🔴 Critical (Invoice Total Undercharging)
- **Location:** `lib/actions/sales.ts:4095-4121`

#### Flawed Code (`lib/actions/sales.ts:4095-4121`):
```ts
const checkoutLines: CheckoutLine[] = quotation.lines.map(line => ({
  productId: line.productId,
  quantity: line.quantity,
  unitPrice: Number(line.unitPrice),
  discountPct: Number(line.discountPct), // ❌ BUG 1: Omits discountAmt: Number(line.discountAmt)!
  serialNumbers: serialAssignments?.[line.id] || [],
  isGift: line.isGift,
}))

// Calculate order discount percentage from quotation
const orderDiscountPct =
  Number(quotation.subtotal) > 0
    ? (Number(quotation.discountAmt) / Number(quotation.subtotal)) * 100 // ❌ BUG 2: quotation.discountAmt ALREADY includes totalLineDiscounts!
    : 0
```
- **Why It Breaks:** When a quotation is saved via `checkout()` (`lib/actions/sales.ts:699, 984`), `quotation.discountAmt` is stored as `totalDiscount = round2(totalLineDiscounts + orderDiscount)` and `quotation.subtotal` is stored as the post-line-discount subtotal (`subtotal = rawSubtotal - totalLineDiscounts`). When `convertQuotationToSale` converts that quotation into a sale:
  1. If the quotation had flat line discounts (`line.discountAmt > 0` with `line.discountPct === 0`), `discountAmt` is dropped from `checkoutLines`, and then converted into `orderDiscountPct = (quotation.discountAmt / quotation.subtotal) * 100`.
  2. If the quotation had percentage line discounts (`line.discountPct > 0`), `checkoutLines` applies `line.discountPct` a first time, AND `orderDiscountPct` applies `quotation.discountAmt` (which includes those line discounts) a **second time** across the entire invoice!
- **Exact Fix Required:** Pass `discountAmt: Number(line.discountAmt)` in `checkoutLines`, and compute the true order-level discount as:
  ```ts
  const lineDiscountsSum = quotation.lines.reduce((s, l) => s + Number(l.discountAmt || 0), 0)
  const trueOrderDiscountAmt = Math.max(0, round2(Number(quotation.discountAmt) - lineDiscountsSum))
  const orderDiscountPct = Number(quotation.subtotal) > 0
    ? (trueOrderDiscountAmt / Number(quotation.subtotal)) * 100
    : 0
  ```

---

### CRIT-09: `PurchaseOrder` Line Discounts Ignored in `StockLayer.unitCost`, `SerialUnit.costPrice`, and `createPurchaseReturn`
- **Severity:** 🔴 Critical (Inventory Asset `GL 1400` vs FIFO Subledger Divergence)
- **Locations:**
  - `lib/actions/purchases.ts:369-447` (`updatePurchaseOrderStatus`)
  - `lib/actions/purchases.ts:2783` (`createPurchaseReturn`)
  - `lib/actions/purchases.ts:3262` (`recordPurchaseReturnAction`)

#### Flawed Code (`lib/actions/purchases.ts:375-425` and `lib/actions/purchases.ts:482`):
```ts
// Lines 375-425: StockLayer and SerialUnit created with un-discounted unitCost:
await tx.serialUnit.create({
  data: {
    serialNumber: sn,
    productId: line.productId,
    outletId: po.outletId,
    costPrice: line.unitCost, // ❌ Uses gross unitCost, ignoring line.discount!
    status: 'IN_STOCK',
    purchaseLineId: line.id,
  },
})
// ...
await createStockLayer(tx, {
  productId: line.productId,
  outletId: po.outletId,
  quantity: line.quantity,
  unitCost: Number(line.unitCost), // ❌ Uses gross unitCost, ignoring line.discount!
  sourceType: 'PURCHASE',
  referenceId: po.id,
})
// Line 482: GL 1400 Inventory is debited by the NET discounted total!
const totalCost = round2(
  po.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost) - Number(l.discount), 0)
)
```
- **Why It Breaks:** When a Purchase Order has a line discount (`line.discount > 0`), `GL 1400 Inventory` is debited by the net amount (`quantity * unitCost - discount`), **but `StockLayer.unitCost` and `SerialUnit.costPrice` are recorded at the gross `line.unitCost`**. When those items are later sold or returned (`createPurchaseReturn` at `lib/actions/purchases.ts:2783`), COGS (`Dr 5100 / Cr 1400`) and purchase returns credit `GL 1400 Inventory` at the gross `unitCost`, driving `GL 1400 Inventory` negative and causing a permanent Balance Sheet discrepancy (`INVENTORY_SUBLEDGER_MISMATCH`).
- **Exact Fix Required:** Compute effective net unit cost per line as `const effectiveUnitCost = round2(Number(line.unitCost) - Number(line.discount) / line.quantity)` and use `effectiveUnitCost` for `SerialUnit.costPrice`, `StockLayer.unitCost`, `StockLedger.unitCost`, and purchase return valuations.

---

### CRIT-10: B2B Transactions (`sellProductToSupplier`, `recordPurchaseFromSupplier`, `makePaymentToSupplier`, `receivePaymentFromSupplier`, `payPurchaseInvoice`) Corrupt `Supplier.outstandingBalance` Sign & Omit MFS Fee from `BankAccount.currentBalance`
- **Severity:** 🔴 Critical (B2B Ledger Corruption & Bank Balance Drift)
- **Locations:**
  - `lib/actions/b2b.ts:996-1003` (`sellProductToSupplier` — increments `Supplier.outstandingBalance` even on cash/bank sales and in the wrong sign direction)
  - `lib/actions/b2b.ts:2486-2492` (`receivePaymentFromSupplier` — decrements `Supplier.outstandingBalance` without updating `Customer.creditBalance`)
  - `lib/actions/b2b.ts:918-921, 1118-1142` (`sellProductToSupplier` MFS fee)
  - `lib/actions/b2b.ts:1357-1360, 1489-1513` (`recordPurchaseFromSupplier` MFS fee)
  - `lib/actions/b2b.ts:2013-2038` (`exchangeWithSupplier` MFS fee)
  - `lib/actions/b2b.ts:2228-2231, 2312-2336` (`makePaymentToSupplier` MFS fee)
  - `lib/actions/b2b.ts:2460-2463, 2544-2568` (`receivePaymentFromSupplier` MFS fee)
  - `lib/actions/b2b.ts:2922-2946` (`payPurchaseInvoice` MFS fee)

#### Flawed Code (`lib/actions/b2b.ts:996-1003` and `lib/actions/b2b.ts:2228-2336`):
```ts
// 1. sellProductToSupplier (lines 996-1003):
// ❌ BUG 1: Supplier.outstandingBalance is an Accounts Payable liability ("We Owe Supplier").
// Selling to a supplier INCREMENTS outstandingBalance even when paid in full by CASH/BANK,
// and in the SAME positive direction as purchasing from the supplier!
await tx.supplier.update({
  where: { id: val.supplierId },
  data: {
    outstandingBalance: {
      increment: totalAmount,
    },
  },
})

// 2. makePaymentToSupplier (lines 2228-2231 & 2312-2336):
await tx.bankAccount.update({
  where: { id: val.bankAccountId },
  data: { currentBalance: { decrement: val.amount } }, // ❌ BUG 2: Only decrements val.amount, ignoring feeAmount!
})
// ... while GL credits 1200 Bank by val.amount AND feeAmount:
if (feeAmount > 0 && feeAccId) {
  glEntries.push(
    { accountId: feeAccId, type: TransactionType.DEBIT, amount: feeAmount, ... },
    { accountId: creditAccId, type: TransactionType.CREDIT, amount: feeAmount, ... } // Credits 1200 Bank!
  )
}
```
- **Why It Breaks:**
  1. In `prisma/schema.prisma:612`, `Supplier.outstandingBalance` represents how much the store owes the supplier (Accounts Payable), while `Customer.creditBalance` (`linkedSupplierId`) represents how much the B2B partner owes the store (Accounts Receivable), as documented in `getApArOverview` (`lib/actions/ap-ar.ts:104-127`) and `computeBalanceSheet` (`lib/reports/balance-sheet.ts:125-171`). Yet `sellProductToSupplier` increments `Supplier.outstandingBalance` by `totalAmount` on every sale (even cash sales!) instead of incrementing `linkedCustomer.creditBalance` by `dueAmount` (`totalAmount - paidAmount`).
  2. Across all 6 B2B functions listed above, whenever `feeAmount > 0` on a bank/MFS payment, the General Ledger credits `1200 Bank Accounts` by `feeAmount`, **but `BankAccount.currentBalance` and `BankTransaction` are never adjusted by `feeAmount`**. Every B2B MFS transaction immediately causes `BankAccount.currentBalance` to exceed `GL 1200 Bank` by `feeAmount`.
- **Exact Fix Required:**
  1. In `sellProductToSupplier`, only increment `linkedCustomer.creditBalance` (or decrement `Supplier.outstandingBalance` if tracking net on supplier) by `dueAmount = round2(totalAmount - amountPaid)` when `paymentMethod === 'CREDIT'`.
  2. In all 6 B2B bank/MFS flows, adjust `BankAccount.currentBalance` and create a `BankTransaction` for `feeAmount` whenever `feeAmount > 0` (matching `giveEmployeeAdvance` at `lib/actions/payroll.ts:1263-1285`).

---

### CRIT-11: Inventory Subledger vs. `GL 1400` Desynchronization in `updateInventorySerialStatus` and `confirmStockTransfer`
- **Severity:** 🔴 Critical (Balance Sheet Imbalance & Inventory Valuation Drift)
- **Locations:**
  - `lib/actions/products.ts:2065-2128` (`updateInventorySerialStatus`)
  - `lib/actions/products.ts:2853-2882` (`confirmStockTransfer`)

#### Flawed Code (`lib/actions/products.ts:2065-2128` and `lib/actions/products.ts:2855-2882`):
```ts
// 1. updateInventorySerialStatus (lines 2065-2092):
if (wasInStock && !willBeInStock) {
  await consumeStockLayersFIFO(tx, existing.productId, existing.outletId, 1)
  await tx.stockLedger.create({
    data: {
      productId: existing.productId,
      outletId: existing.outletId,
      movementType: StockMovementType.ADJUSTMENT_OUT,
      quantity: -1,
      unitCost: existing.costPrice ?? existing.product.costPrice,
      referenceType: 'SerialStatusChange',
      referenceId: existing.id,
      userId: user.id,
    },
  })
  // ❌ BUG 1: Consumes StockLayer & creates StockLedger ADJUSTMENT_OUT, but posts ZERO AccountLedgerEntry rows!
}

// 2. confirmStockTransfer (lines 2855-2882):
for (const line of transfer.lines) {
  const product = await tx.product.findUnique({
    where: { id: line.productId },
    select: { costPrice: true },
  })
  const unitCost = Number(product?.costPrice ?? 0) // ❌ BUG 2: Uses catalog product.costPrice instead of source FIFO batch cost!
  await createStockLayer(tx, {
    productId: line.productId,
    outletId: transfer.toOutletId,
    quantity: line.quantity,
    unitCost,
    sourceType: 'TRANSFER_IN',
    referenceId: transfer.id,
  })
}
```
- **Why It Breaks:**
  1. Marking a serial unit `DEAD` or `RETURNED_TO_SUPPLIER` via `updateInventorySerialStatus` removes the unit from `StockLayer` and `StockLedger`, **but never posts `Dr 5300 Stock Shrinkage / Cr 1400 Inventory`** (unlike `adjustStock` at `lib/actions/products.ts:2383-2442`). Restoring a serial to `IN_STOCK` creates a `StockLayer` without debiting `GL 1400`.
  2. When transferring stock via `createStockTransfer` (`lib/actions/products.ts:2765`), `consumeStockLayersFIFO` consumes actual FIFO cost layers at the source outlet, but `confirmStockTransfer` (`lib/actions/products.ts:2859`) creates the destination `StockLayer` at `product.costPrice` (catalog default cost), altering total FIFO inventory value across outlets. (Note: `lib/actions/transfers.ts` is dead duplicate code not wired to the UI).
- **Exact Fix Required:**
  1. In `updateInventorySerialStatus`, post balanced GL entries (`Dr 5300 / Cr 1400` using the consumed layer cost when leaving `IN_STOCK`, and `Dr 1400 / Cr 4400` when returning to `IN_STOCK`).
  2. Store `unitCost` on `StockTransferLine` from the `consumeStockLayersFIFO` result during `createStockTransfer`, and use that exact `unitCost` in `confirmStockTransfer`.

---

### CRIT-12: Manual Bank Transactions (`createBankTransaction`) Unconditionally Post Against `GL 1100 Cash in Hand` Without Touching `CashDrawer`
- **Severity:** 🔴 High (Cash in Hand `GL 1100` vs Physical `CashDrawer` Divergence)
- **Location:** `lib/actions/bank.ts:275-330`

#### Flawed Code (`lib/actions/bank.ts:285-328`):
```ts
const isDeposit = val.type === 'DEPOSIT'
const glEntries = [
  {
    accountId: isDeposit ? bankAccId : cashAccId,
    type: TransactionType.DEBIT,
    amount: val.amount,
    description: val.description || `Bank ${val.type.toLowerCase()}`,
    referenceId: createdTx.id,
    referenceType: 'BankTransaction',
  },
  {
    accountId: isDeposit ? cashAccId : bankAccId, // ❌ Always credits/debits GL 1100 Cash in Hand!
    type: TransactionType.CREDIT,
    amount: val.amount,
    description: val.description || `Bank ${val.type.toLowerCase()}`,
    referenceId: createdTx.id,
    referenceType: 'BankTransaction',
  },
]
```
- **Why It Breaks:** Every manual `DEPOSIT` or `WITHDRAWAL` recorded in `createBankTransaction` debits or credits `GL 1100 Cash in Hand`, **but never creates a `DrawerTransaction` on any `CashDrawer`**. In `computeBalanceSheet` (`lib/reports/balance-sheet.ts:81-118`) and `getDailyCashReport` (`lib/actions/cash-report.ts:989-1027`), physical cash on hand is reconciled against `GL 1100`, so any manual bank transaction immediately triggers a cash discrepancy and unbalances the Balance Sheet.
- **Exact Fix Required:** Require the user to specify the counter-account on manual bank transactions (e.g., `CashDrawer` with a corresponding `DrawerTransaction`, or a specific Chart of Accounts income/expense/equity code such as `3100 Owner's Capital` / `4400 Other Income` / `5291 Bank Charges`).

---

### CRIT-13: Missing RBAC & Multi-Outlet Isolation (IDOR) Across API Routes and Server Actions
- **Severity:** 🔴 High (Privilege Escalation, Confidential Cost Price Exposure & Cross-Outlet Data Leak)
- **Locations:**
  1. `app/api/products/[id]/route.ts:6-95` (`DELETE` and `PATCH`)
  2. `app/api/products/export/route.ts:9-148` (`GET`)
  3. `lib/actions/purchases.ts:1734, 1982, 2035` (`getPurchaseInvoiceById`, `updatePurchaseInvoiceNotes`, `getPurchaseInvoiceEditLogs`)
  4. `lib/actions/sales.ts:2671, 3320, 4312` (`getSaleReturnPreview`, `resendSaleReceipt`, `getSaleEditLogs`)
  5. `lib/actions/internal-repair.ts:30, 125` (`dispatchInternalRepair`, `resolveInternalRepair`)
  6. `lib/actions/payroll.ts:1508` (`getPayrollPeriodById`)

#### Flawed Code (`app/api/products/[id]/route.ts:6-37` and `app/api/products/export/route.ts:9-35`):
```ts
// 1. app/api/products/[id]/route.ts:6-37:
export async function DELETE(_request: NextRequest, context: { params: Promise<any> }) {
  const session = await auth() // ❌ Does not check dbUser.isActive, role, or currentStock > 0!
  const outletId = session?.user?.outletId
  if (!session?.user || !outletId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await context.params
  // ... immediately sets isActive: false without checking role or remaining stock!

// 2. app/api/products/export/route.ts:9-35:
export async function GET(request: NextRequest) {
  const user = await requireAuth(); // ❌ Any role (CASHIER, TECHNICIAN, HR) can export 1,000,000 products with costPrice!
  const raw = await getProductList(user.outletId, {
    // ...
    pageSize: 1000000,
    includeSerials: true,
  });
```
- **Why It Breaks:**
  1. Any authenticated `CASHIER`, `TECHNICIAN`, or `HR` user can call `DELETE /api/products/[id]` to archive an active product even when it has positive stock (`currentStock > 0`), bypassing `archiveProduct` (`lib/actions/products.ts:1182`) which enforces `requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER')` and blocks archiving products with remaining stock.
  2. Any authenticated user can call `GET /api/products/export` to download the entire product catalog including confidential `costPrice` (column 10) and all `IN_STOCK` serial numbers, while `pageSize: 1000000` with `includeSerials: true` creates an in-memory OOM DoS vector.
  3. The server actions listed in (3)–(6) call `requireAuth()` or `requireRole()` without calling `validateOutletAccess(user, record.outletId)`, allowing a manager or cashier in Outlet A to read/modify records belonging to Outlet B by passing Outlet B's CUID.
- **Exact Fix Required:**
  1. In `app/api/products/[id]/route.ts`, delegate `DELETE` and `PATCH` to `archiveProduct(id)` and `restoreProduct(id)` (or enforce `requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER')` and check `getOutletStockMap` before archiving).
  2. In `app/api/products/export/route.ts`, enforce `requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER')`, cap `pageSize` (or stream rows), and redact `costPrice` for non-privileged roles.
  3. Add `validateOutletAccess(user, targetOutletId)` to `getPurchaseInvoiceById`, `updatePurchaseInvoiceNotes`, `getPurchaseInvoiceEditLogs`, `getSaleReturnPreview`, `resendSaleReceipt`, `getSaleEditLogs`, `dispatchInternalRepair`, `resolveInternalRepair`, and `getPayrollPeriodById`.

---

### CRIT-14: Checkout Dialog Hardcodes `taxAmt = 0` & Displays Pre-Line-Discount Total in Primary Banner
- **Severity:** 🔴 High (Client/Server Checkout Math Mismatch & Cashier Over/Under-Collection)
- **Locations:**
  - `components/sales-terminal/checkout-dialog.tsx:235-263` (`taxAmt = 0` hardcoded)
  - `components/sales-terminal/checkout-dialog.tsx:610-612` (Zone 1 massive total banner)
  - `components/sales-terminal/checkout-dialog.tsx:658-664` (Order discount input `max={subtotal}`)
  - `components/sales-terminal/active-cart.tsx:285-305` (Fetches `getDefaultTaxRate()`)

#### Flawed Code (`components/sales-terminal/checkout-dialog.tsx:243-263` and `606-613`):
```tsx
// Lines 243-263:
const netSubtotal = Math.max(0, subtotal - lineDiscountsTotal)
const discount = Math.min(Math.max(0, orderDiscountAmt), netSubtotal)
const discountPctEquivalent = netSubtotal > 0 ? (discount / netSubtotal) * 100 : 0
const finalTotalBeforeTaxAndFees = netSubtotal - discount
// ❌ BUG 1: Hardcodes taxAmt = 0 while ActiveCart and server checkout() apply default_tax_rate!
const taxAmt = 0
const customerFees = payments.reduce((sum, p) => { ... }, 0)
const total = finalTotalBeforeTaxAndFees + taxAmt + customerFees

// Lines 606-613 (Zone 1: The Bill - Massive Total):
<div className="flex flex-col items-center justify-center py-5 sm:py-8 bg-muted/10 rounded-2xl px-2">
  <span className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-1 sm:mb-2">
    Total Amount
  </span>
  <span className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black font-mono tabular-nums tracking-tighter text-foreground text-center financial-total-lg">
    {/* ❌ BUG 2: Uses (subtotal - discount) instead of `total` — completely ignores lineDiscountsTotal, taxAmt, and customerFees! */}
    ৳{Math.max(0, subtotal - discount).toFixed(2)}
  </span>
</div>
```
- **Why It Breaks:**
  1. When a cashier applies a line-item discount (`Dis: ৳500` in `ActiveCart`) or selects a payment method with `CUSTOMER_PAYS` fee (`customerFees > 0`), the 6xl "Total Amount" banner at `checkout-dialog.tsx:611` displays `subtotal - discount` (ignoring `lineDiscountsTotal` and `customerFees`), while the "Remaining Due" / "Fully Paid" box in Zone 3 (`checkout-dialog.tsx:882-918`) and the "Exact Cash" button (`checkout-dialog.tsx:770`) use `total` (`netSubtotal - discount + customerFees`)!
  2. If `default_tax_rate > 0` in Settings, `ActiveCart` (`active-cart.tsx:303`) adds tax to the cart total, `CheckoutDialog` sets `taxAmt = 0` and only allows the cashier to enter the pre-tax amount for non-cash tenders (`nonCashPaid > total + 0.01`), and then server `checkout()` (`lib/actions/sales.ts:694-712`) adds tax back and rejects the sale for insufficient payment!
- **Exact Fix Required:**
  1. In `CheckoutDialog`, fetch/pass `taxRatePct` (matching `ActiveCart`) and compute `taxAmt = Math.round(((finalTotalBeforeTaxAndFees * (taxRatePct / 100)) + Number.EPSILON) * 100) / 100`.
  2. Replace `৳{Math.max(0, subtotal - discount).toFixed(2)}` at `components/sales-terminal/checkout-dialog.tsx:611` with `৳{total.toFixed(2)}`.
  3. At `components/sales-terminal/checkout-dialog.tsx:658-664`, cap the Order Discount input at `netSubtotal` instead of `subtotal`.

---

### CRIT-15: `getBankAccountStatement` Double-Counts Pre-Window Transactions on Page 2+ (`skip > 0`)
- **Severity:** 🔴 High (Corrupted Running Bank Statement Balance on Paginated Views)
- **Location:** `lib/actions/bank.ts:911-952`

#### Flawed Code (`lib/actions/bank.ts:911-951`):
```ts
let windowOpeningBalance = Number(account.openingBalance)
if (fromDate) {
  const beforeWindowAgg = await prisma.$queryRaw<Array<{ net: number }>>`
    SELECT COALESCE(SUM(CASE WHEN type IN ('DEPOSIT', 'TRANSFER_IN') THEN amount ELSE -amount END), 0)::float AS net
    FROM "BankTransaction"
    WHERE "bankAccountId" = ${account.id}
      AND "transactionAt" < ${fromDate}
  `
  windowOpeningBalance = round2(windowOpeningBalance + Number(beforeWindowAgg[0]?.net || 0))
}

let pageOpeningBalance = windowOpeningBalance
if (skip > 0 && total > 0) {
  // ❌ BUG: Ignores windowWhere (fromDate, toDate, type, search)! Re-sums transactions before fromDate!
  const prevAgg = await prisma.$queryRaw<Array<{ net: number }>>`
    SELECT COALESCE(SUM(CASE WHEN sub.type IN ('DEPOSIT', 'TRANSFER_IN') THEN sub.amount ELSE -sub.amount END), 0)::float AS net
    FROM (
      SELECT type, amount
      FROM "BankTransaction"
      WHERE "bankAccountId" = ${account.id}
      ORDER BY "transactionAt" ASC, id ASC
      LIMIT ${skip}
    ) sub
  `
  pageOpeningBalance = round2(windowOpeningBalance + Number(prevAgg[0]?.net || 0))
}
```
- **Why It Breaks:** When `fromDate` is set and the user navigates to Page 2 (`skip > 0`), `windowOpeningBalance` already includes all transactions prior to `fromDate`. Because `prevAgg` omits `AND "transactionAt" >= ${fromDate}` (and any `toDate`, `type`, or `search` filters), the first `skip` transactions from the beginning of time are added a **second time** into `pageOpeningBalance`!
- **Exact Fix Required:** Apply the exact same `fromDate` / `toDate` / `type` / `search` predicates from `windowWhere` inside the `prevAgg` subquery.

---

### CRIT-16: POS `ProductBrowser` Never Refreshes Client State After Checkout, Showing Stale Stock & Sold Serials
- **Severity:** 🔴 High (Stale POS Inventory & Duplicate Serial Selection Attempt)
- **Locations:** `components/sales-terminal/product-browser.tsx:98-125` and `components/sales-terminal/index.tsx:219-229`

#### Flawed Code (`components/sales-terminal/product-browser.tsx:98-125`):
```ts
// Load products
useEffect(() => {
  if (!outletId) return
  let cancelled = false
  setIsLoading(true)

  getProductsForPos(
    outletId,
    debouncedSearch || undefined,
    activeCategory === 'All' ? undefined : activeCategory
  ).then(data => {
    if (!cancelled) {
      setProducts(data as unknown as ProductWithStock[])
      setIsLoading(false)
    }
  })
  // ...
}, [outletId, debouncedSearch, activeCategory]) // ❌ Never re-runs after a sale is completed!
```
- **Why It Breaks:** `SalesPage` (`app/(app)/sales/page.tsx`) renders `<SalesTerminal />`, a pure Client Component tree. `ProductBrowser` fetches products via the `getProductsForPos` Server Action inside a `useEffect` that only depends on `[outletId, debouncedSearch, activeCategory]`. Even though `checkout()` calls `revalidatePath('/sales')`, React `useState` inside `ProductBrowser` is not reset or re-fetched when a sale completes (`handleCheckoutSuccess` / `handleNewSale`). As a result, after completing a sale, the product grid still displays the old `availableStock` badge and keeps 0-stock items visible until the cashier manually switches categories or changes the search text.
- **Exact Fix Required:** Pass a `refreshKey` (incremented in `SalesTerminal.handleCheckoutSuccess` and when offline sales finish syncing) into `<ProductBrowser refreshKey={refreshKey} />` and include `refreshKey` in the `useEffect` dependency array at `components/sales-terminal/product-browser.tsx:125`.

---

## 3. Medium-Severity Issues

### MED-01: `AccountLedgerEntry` Lacks `outletId` Column, Breaking Multi-Outlet GL Reports & Cross-Checks
- **Locations:** `prisma/schema.prisma:1253-1270`, `lib/actions/finance.ts:1707-1738`, `lib/actions/cash-report.ts:989-1027`, `lib/reports/balance-sheet.ts:44`
- **Issue:** `ChartOfAccount` and `AccountLedgerEntry` are global tables with no `outletId` column. In a multi-outlet deployment:
  - `getProfitLossReport(outletId, ...)` (`lib/actions/finance.ts:1707-1738`) compares single-outlet `Sale` and `Expense` subledgers against the global `AccountLedgerEntry` table (`GL 4100`, `5100`, `5200`), logging false `[P&L GL Cross-Check] Discrepancy detected` warnings on every run.
  - `getDailyCashReport(outletId, ...)` (`lib/actions/cash-report.ts:989-1027`) compares single-outlet `CashDrawer` movements against global `GL 1100 Cash in Hand`, reporting false `gl1100Discrepancy` values.
  - `getAccountLedger` (`lib/actions/finance.ts:288`) and `computeBalanceSheet` (`lib/reports/balance-sheet.ts:44`) cannot filter by `outletId`.
- **Fix:** Add `outletId String?` with `@relation(fields: [outletId], references: [id])` and `@@index([outletId, accountId, createdAt])` to `AccountLedgerEntry` in `prisma/schema.prisma`, and populate `outletId` in all GL posting sites.

---

### MED-02: Dangerous `onDelete: Cascade` & Missing Foreign Key Constraints in `prisma/schema.prisma`
- **Locations:** `prisma/schema.prisma:1039, 1084, 1105, 1138, 1255, 1280`
- **Issues:**
  1. `AccountLedgerEntry.account` (`prisma/schema.prisma:1255`) has `onDelete: Cascade`: deleting a `ChartOfAccount` row silently wipes all historical General Ledger entries for that account, permanently unbalancing every historical journal in the database. Change to `onDelete: Restrict`.
  2. `DrawerTransaction.drawer` (`prisma/schema.prisma:1280`) has `onDelete: Cascade`: deleting a `CashDrawer` wipes all historical cash movement records. Change to `onDelete: Restrict`.
  3. `SaleLine.sale` (`prisma/schema.prisma:1039`), `SaleLineSerial.saleLine` (`prisma/schema.prisma:1084`), `SaleLineSerial.serialUnit` (`prisma/schema.prisma:1085`), and `SalePayment.sale` (`prisma/schema.prisma:1105`) use `onDelete: Cascade`. While `deleteSale` intentionally cleans up before deleting a sale, accidental deletion of a `SerialUnit` cascades to `SaleLineSerial`, erasing historical serial trace from completed sales invoices. Change `SaleLineSerial.serialUnit` to `onDelete: Restrict`.
  4. `StockLedger.userId` (`prisma/schema.prisma:679`), `AuditLog.userId` (`prisma/schema.prisma:1491`), and `SaleEditLog.editedById` (`prisma/schema.prisma:1189`) are bare `String?` / `String` columns with no `@relation` to `User`.

---

### MED-03: Missing Composite Indexes on High-Frequency Lookup Columns
- **Locations:** `prisma/schema.prisma`
- **Missing Indexes Identified:**
  1. `SerialUnit` (`prisma/schema.prisma:638-669`): Missing `@@index([productId, outletId, status])`. `getInStockSerialsForProduct` (`lib/actions/products.ts:2185`), `getProductList` (`lib/actions/products.ts:953`), and `getProductsForPos` (`lib/actions/products.ts:2140`) filter by `{ productId, outletId, status: 'IN_STOCK' }`, forcing index intersection on single-column indexes.
  2. `Sale` (`prisma/schema.prisma:995-1033`): Missing `@@index([outletId, isQuotation, createdAt])` and `@@index([outletId, customerId, createdAt])`. Every dashboard, sales list, P&L, and due report filters `Sale` by `outletId`, `isQuotation: false`, and `createdAt`.
  3. `PurchaseOrder` (`prisma/schema.prisma:794-828`): Only has `@@index([orderNumber])`! Missing `@@index([outletId, status, createdAt])` and `@@index([supplierId, outletId])`.
  4. `PurchaseInvoice` (`prisma/schema.prisma:852-887`): Missing `@@index([supplierId, createdAt])` and `@@index([poId])`.
  5. `BankTransaction` (`prisma/schema.prisma:1319-1340`): Has `@@index([bankAccountId])` and `@@index([transactionAt])` separately, but lacks composite `@@index([bankAccountId, transactionAt, id])` used by `getBankAccountStatement` (`lib/actions/bank.ts:914, 938`).
  6. `AccountLedgerEntry` (`prisma/schema.prisma:1253-1270`): Missing `@@index([accountId, createdAt])` and `@@index([referenceType, referenceId])` (currently only has single-column `@@index([accountId])`, `@@index([referenceId])`, `@@index([createdAt])`).
  7. `AuditLog` (`prisma/schema.prisma:1489-1504`): Missing `@@index([action, entityId, createdAt])` used on **every login and manager PIN check** (`lib/auth/authorize.ts:34-42`, `lib/security/manager-pin.ts:132-140`) to query `LOGIN_FAILED` / PIN failure lockouts in the last 15 minutes.

---

### MED-04: N+1 Sequential Query Patterns in Hot Paths
- **Locations:**
  1. `lib/actions/fixed-assets.ts:590-610` (`executeFixedAssetDepreciation`): Loops over `depreciableAssets` and executes `await tx.accountLedgerEntry.findMany({ where: { referenceId: asset.id, referenceType: 'Depreciation', type: 'DEBIT' } })` inside the loop instead of a single `tx.accountLedgerEntry.groupBy({ by: ['referenceId'], _sum: { amount: true } })`.
  2. `lib/actions/payroll.ts:289-420` (`generatePayrollPeriod`): Executes 4–6 queries per employee inside `for (const emp of employees)` (`salaryStructure.findFirst`, `attendance.findMany`, `sale.findMany`, `serviceJob.findMany`, `employeeAdvance.findMany`, `payrollEntry.create`) inside a single interactive transaction—will time out for outlets with >30 employees.
  3. `lib/actions/products.ts:2218-2315` (`bulkImportProducts`): Runs `findUnique` + `product.create` + `createStockLayer` + `stockLedger.create` sequentially per row inside a single interactive transaction.
  4. `lib/actions/sales.ts:1132-1239` (`checkout`): Executes `tx.saleLine.create`, `tx.serialUnit.findUnique`, `tx.serialUnit.update`, `tx.saleLineSerial.create`, and `tx.stockLedger.create` per line/serial inside nested loops.

---

### MED-05: `createSaleReturn` Edge Cases — Order-Level Discount & Tax Omitted When Refunding Lines, and Store Credit Expiry Timezone Drift
- **Locations:** `lib/actions/sales.ts:2196-2665` (`createSaleReturn`)
- **Issues:**
  1. Look at `lib/actions/sales.ts:2270-2285`:
     ```ts
     const unitRefundPrice = saleLine.quantity > 0
       ? Number(saleLine.total) / saleLine.quantity
       : Number(saleLine.unitPrice)
     const lineRefundAmount = round2(unitRefundPrice * returnLine.quantity)
     ```
     In `Sale`, `saleLine.total` only subtracts **line-level** discounts (`line.discountAmt`), NOT **order-level** discounts (`orderDiscount`) or `taxAmt` (`lib/actions/sales.ts:666-698`)!
     If a customer buys a ৳10,000 item with a ৳1,000 **order-level** discount (paying `Sale.total = ৳9,000`, while `saleLine.total = ৳10,000`), and later returns the item via `createSaleReturn`:
     - `lineRefundAmount` is calculated from `saleLine.total` (`৳10,000`), which is then clamped at `lib/actions/sales.ts:2305` (`if (totalRefundAmount > maxRefundable)` where `maxRefundable = Number(sale.total) - alreadyRefunded = ৳9,000`) ONLY on a full return!
     - On a **partial return** (e.g., returning 1 of 2 items from an order that had an order-level discount), `unitRefundPrice` uses the pre-order-discount `saleLine.total / saleLine.quantity`, **over-refunding the customer by the order-level discount on the returned item**!
  2. Furthermore, `createSaleReturn` (`lib/actions/sales.ts:2493-2501`) always debits `4110 Sales Returns & Allowances` by `totalRefundAmount` without reversing proportional `2200 Tax Payable` when `sale.taxAmt > 0`.

---

### MED-06: Customer Group Discount Lost on Page Reload / Held Sale Recall in `CustomerSearch`
- **Locations:** `components/sales-terminal/customer-search.tsx:51-62` and `lib/actions/crm.ts:261-269`
- **Issue:** When the POS terminal reloads or a held sale is recalled, `usePosCartStore` rehydrates `customerId`. `CustomerSearch`'s `useEffect` (`components/sales-terminal/customer-search.tsx:51-62`) calls `getCustomerById(customerId)` and hardcodes `groupName: null, groupDiscountPct: 0` on the local `selectedCustomer` chip because `getCustomerById` (`lib/actions/crm.ts:261-269`) does not `include: { group: true }`.

---

### MED-07: Serialized Product Quantity Update (`updateQuantity`) Spawns Duplicate Rows & Drops Custom `unitPrice`
- **Locations:** `lib/stores/pos-cart.ts:201-220` and `components/sales-terminal/index.tsx:152-155`
- **Issue:**
  1. In `SalesTerminal.handleUpdateQuantity` (`components/sales-terminal/index.tsx:152-155`), clicking `+` on a serialized item calls `addItem(item.product)` without passing `item.unitPrice`, resetting the new row's price to catalog price.
  2. In `usePosCartStore.updateQuantity` (`lib/stores/pos-cart.ts:205-214`), if `updateQuantity(id, quantity)` is called with `quantity > 1`, it spawns `quantity - 1` new rows with `unitPrice: item.product.price` without checking how many rows already exist for that product.

---

### MED-08: Excel Export Currency Symbol Hardcoded to `$` Instead of `৳` / `BDT`
- **Location:** `app/api/products/export/route.ts:171-174`
- **Issue:** `cell.numFmt = '"$"#,##0.00'` formats exported product Cost Price and Selling Price in US Dollars (`$`) instead of Bangladeshi Taka (`৳` or `BDT`), contradicting the rest of the application.

---

## 4. UI/UX, POS Ergonomics & Print Improvements

### UI-01: Printed A4 Sales Invoice (`SalesInvoiceLayout`) Omits `Discount` and `Grand Total` Rows in `tfoot`
- **Severity:** 🟠 High (Customer-Facing Print Bug)
- **Location:** `components/receipt/a4-invoice.tsx:684-743`

#### Flawed Code (`components/receipt/a4-invoice.tsx:684-730`):
```tsx
<tfoot>
  <tr>
    <td colSpan={2} className="border border-black"></td>
    <td colSpan={3} className="border border-black p-1.5 pr-3 text-right font-bold uppercase tracking-wider text-[10.5px] text-[#374151]">
      Sub Total
    </td>
    <td className="border border-black p-1.5 text-right font-bold tabular-nums text-[11.5px] text-black">
      {formatMoney(subtotal)}
    </td>
  </tr>
  {/* ❌ MISSING: Discount row (discountTotal) and Grand Total / Net Payable row (grandTotal)! */}
  <tr>
    <td colSpan={2} className="border border-black p-1.5 text-center font-semibold text-[11px] text-[#1f2937]">
      {paymentInfoString}
    </td>
    <td colSpan={3} className="border border-black p-1.5 pr-3 text-right font-bold uppercase tracking-wider text-[10.5px] text-[#374151]">
      Paid Amount
    </td>
    <td className="border border-black p-1.5 text-right font-bold tabular-nums text-[11.5px] text-[#065f46]">
      {formatMoney(paidAmount)}
    </td>
  </tr>
```
- **Impact:** Whenever a sale has an order discount (or line discount where `subtotal > grandTotal`), the printed A4 `SALES INVOICE` shows `Sub Total: 50,000.00`, `Paid Amount: 48,000.00`, `Outstanding: 0.00`, and `Amount in words: FORTY EIGHT THOUSAND TAKA ONLY`—with **no `Discount` row and no `Grand Total` row** explaining why `50,000.00` became `48,000.00`!
- **Fix:** Add conditional `Discount` (`toNumber( props.discountTotal ) > 0`) and `Grand Total` (`formatMoney(grandTotal)`) rows to `SalesInvoiceLayout`'s `tfoot` in `components/receipt/a4-invoice.tsx:696`, matching lines 1305–1321 of the generic `A4Invoice` layout.

---

### UI-02: Thermal Receipt (`ThermalReceipt`) CSS Selector Mismatch (`#thermal-receipt` vs `.thermal-receipt`) & Missing Serial / Warranty / Due Info
- **Severity:** 🟠 Medium-High (Broken Thermal Print Styling & Incomplete Receipt Data)
- **Locations:** `components/receipt/thermal-receipt.tsx:71-118, 209-345` and `app/globals.css:444-549`
- **Issues:**
  1. `app/globals.css:444-549` scopes its report print overrides using `:not(:has(.thermal-receipt))` (a class selector), whereas `components/receipt/thermal-receipt.tsx:117` renders `<div id="thermal-receipt">` without `className="thermal-receipt"`. As a result, `globals.css` `@media print` rules override table widths, padding, and borders inside `#thermal-receipt` when printing!
  2. `ThermalReceipt` (`components/receipt/thermal-receipt.tsx:209-241`) does not render item serial numbers (`line.serials`) or warranty expiry dates—essential on electronics/laptop receipts.
  3. `ThermalReceipt` (`components/receipt/thermal-receipt.tsx:304-336`) does not show `Amount Paid` vs `Balance Due / Outstanding` for credit or partially paid sales.
  4. `ThermalReceipt` (`components/receipt/thermal-receipt.tsx:340`) encodes only `sale.saleNumber` in `<QRCodeSVG value={sale.saleNumber} />` instead of the signed verification URL.
- **Fix:** Add `className="thermal-receipt"` to `<div id="thermal-receipt">` in `components/receipt/thermal-receipt.tsx:117`, render serial numbers under each item description, and display `Paid` and `Balance Due` lines.

---

### UI-03: POS Cashier Ergonomics & Keyboard Navigation Gaps
- **Locations:**
  - `components/sales-terminal/product-browser.tsx:65-83`
  - `components/sales-terminal/active-cart.tsx:56-174`
  - `components/sales-terminal/checkout-dialog.tsx:320-564`
- **Issues:**
  1. **No Auto-Focus on Payment Input When Opening `CheckoutDialog`:** Pressing `F12` opens `CheckoutDialog`, but no input is focused automatically, and pressing `Enter` inside the payment amount input (`components/sales-terminal/checkout-dialog.tsx:727-737`) does not trigger `handleConfirm()`. Cashiers must switch from keyboard to mouse to click "Confirm Payment".
  2. **`SerialSlotPicker` Modal Lacks Keyboard Arrow/Enter Selection (`components/sales-terminal/active-cart.tsx:117-169`):** When searching for a serial number in `SerialSlotPicker`, pressing `Enter` in the search `<Input>` (`active-cart.tsx:117-123`) does not select the top matching serial number—requiring a mouse click for every serialized laptop.
  3. **No Hotkey for Hold Sale (`F4` / `F8`) or Customer Search (`F3`):** Only `F2` (Barcode), `Ctrl+K` (Search), `F12` (Checkout), and `Esc` (Clear Cart) have hotkeys. Adding `F3` (Focus Customer Search) and `F8` (Hold/Recall Sale) will enable 100% keyboard-driven billing.
  4. **`Esc` Hotkey Conflict (`components/sales-terminal/index.tsx:240-247`):** Pressing `Esc` while typing in the product search bar or barcode input triggers `handleClearCart()` (`Clear Active Cart?` confirmation dialog) because `enableOnFormTags: true` is set on the global `esc` hotkey without checking if `showCheckout` or a nested modal/input is active.

---

### UI-04: Design System & Table Alignment Inconsistencies
- **Locations:**
  - `components/sales-terminal/product-browser.tsx:455-494` (Details View missing stock badge)
  - `components/sales-terminal/customer-search.tsx:201` (Hardcoded `bg-blue-50 dark:bg-blue-950/20 border-blue-200`)
  - `app/(app)/reports/profit-loss/page.tsx:425-436` (Inconsistent fraction digits `maximumFractionDigits: 0` vs `.toFixed(2)`)
- **Issues:**
  1. In `ProductBrowser` (`components/sales-terminal/product-browser.tsx:422-496`), switching from `tiles` view to `details` (list) view completely hides the `availableStock` badge—cashiers cannot see how many units are in stock in list view!
  2. In `ProfitLossReportPage` (`app/(app)/reports/profit-loss/page.tsx:425-436`), `Discount`, `Unit Sale`, and `Profit Per Unit` use `maximumFractionDigits: 0` (rounding away poisha/cents in the UI table), while `Unit Cost`, `Total Sale`, and `Total Profit` render full decimals, causing visual row math (`Unit Sale - Unit Cost != Profit Per Unit`) to appear off by ৳1.

---

## 5. Prioritized Refactoring Roadmap

To remediate all findings safely without regressions, execute the fixes in the following **6 logical, atomic commits**:

### Phase 1 — Critical POS Checkout, Sale Edit/Delete & Quotation Math Fixes (Commit 1)
1. **`lib/actions/sales.ts` (`deleteSale` & `resubmitSaleEdit`):**
   - Remove `if (!oldLine.isGift)` around `StockLayer` restoration (`lines 5443, 5777`) so complimentary gift `StockLayer` quantities are properly restored.
   - Add the `SAL-008` closed-drawer guard and `FOR UPDATE` row locking with atomic `{ increment: restore }` on `StockLayer` inside `resubmitSaleEdit` (`lines 5777-5826`).
   - Preserve `oldSale.createdAt` as the default `saleDate` in `resubmitSaleEdit` when not explicitly overridden.
2. **`lib/actions/sales.ts` (`updateSaleItems`):**
   - Enforce `requiresSerial` count/uniqueness and `serial.productId === line.productId` (`lines 4775-4801`), set `warrantyExpiry`, use `serial.costPrice` for serialized COGS, recalculate `Sale.changeDue`, and deduct `newChangeDue` from `DrawerTransaction` (`line 5024`).
3. **`lib/actions/sales.ts` (`convertQuotationToSale`):**
   - Pass `discountAmt: Number(line.discountAmt)` on each line and subtract `lineDiscountsSum` from `quotation.discountAmt` before computing `orderDiscountPct` (`lines 4095-4121`).

### Phase 2 — Accounting, General Ledger & Subledger Integrity Fixes (Commit 2)
1. **`lib/actions/ap-ar.ts` (`recordSupplierPaymentAction`):**
   - Post balanced `AccountLedgerEntry` rows (`Dr 2100 Accounts Payable`, `Cr 1100 Cash in Hand` / `Cr 1200 Bank Accounts`) inside the transaction (`line 880`).
2. **`lib/actions/crm.ts` (`receivePaymentFromCustomer`):**
   - Fix Chart of Accounts mapping (`1200` = Bank, `1300` = Accounts Receivable), add `FOR UPDATE` lock and overpayment guard, or delegate directly to `recordCustomerCollectionAction` (`lines 432-468`).
3. **`lib/actions/service.ts` (`createServiceInvoice` & `collectServicePayment`):**
   - Add the offsetting `CREDIT` entry (and `BankAccount.currentBalance` adjustment) for `feeAmount` (`lines 1512-1535, 1806-1828`) so `assertBalancedJournal` never crashes on MFS/card service payments.
4. **`lib/actions/b2b.ts` (`sellProductToSupplier` & all 6 B2B bank/MFS actions):**
   - Fix `Supplier.outstandingBalance` vs `Customer.creditBalance` updates on B2B sales/collections (`lines 996-1003, 2486-2492`) and deduct `feeAmount` from `BankAccount.currentBalance` + `BankTransaction` whenever `feeAmount > 0`.
5. **`lib/actions/purchases.ts`, `lib/actions/products.ts`, `lib/actions/bank.ts`:**
   - Apply net discounted unit cost (`unitCost - discount / quantity`) to `StockLayer` and `SerialUnit` in `updatePurchaseOrderStatus` (`lib/actions/purchases.ts:375-425`).
   - Post `GL 1400` / `5300` entries in `updateInventorySerialStatus` (`lib/actions/products.ts:2065-2128`) and preserve source FIFO `unitCost` in `confirmStockTransfer` (`lib/actions/products.ts:2855-2882`).
   - Require a counter-account / drawer link in `createBankTransaction` (`lib/actions/bank.ts:275-330`) and apply `windowWhere` filters to `prevAgg` in `getBankAccountStatement` (`lib/actions/bank.ts:930-948`).

### Phase 3 — Cash Drawer Session & Multi-Shift Reporting Fixes (Commit 3)
1. **`lib/actions/drawer-session-utils.ts`, `lib/actions/z-report.ts`, `lib/actions/cash-report.ts`:**
   - Fix `getDailyCashReport` (`lib/actions/cash-report.ts:160-196`) to use the earliest drawer session's opening balance (or sum per-session net movements without double-counting carryover opening balances).
   - Scope `getZReport` (`lib/actions/z-report.ts:185-217, 300-324`) so `DrawerTransaction` and `SalePayment` tender breakdowns cover the exact same drawer session window(s).

### Phase 4 — Security, RBAC & Multi-Outlet Isolation Hardening (Commit 4)
1. **`app/api/products/[id]/route.ts` & `app/api/products/export/route.ts`:**
   - Enforce `requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER')` and stock-zero checks before archiving products (`app/api/products/[id]/route.ts:6-95`).
   - Restrict `/api/products/export` to management roles, cap `pageSize`, and fix currency formatting (`৳#,##0.00`).
2. **Server Actions Outlet Isolation (`validateOutletAccess`):**
   - Add `validateOutletAccess(user, record.outletId)` to `getPurchaseInvoiceById`, `updatePurchaseInvoiceNotes`, `getPurchaseInvoiceEditLogs`, `getSaleReturnPreview`, `resendSaleReceipt`, `getSaleEditLogs`, `dispatchInternalRepair`, `resolveInternalRepair`, and `getPayrollPeriodById`.

### Phase 5 — Database Schema, Constraints & Indexing Migration (Commit 5)
1. **`prisma/schema.prisma`:**
   - Change `onDelete: Cascade` to `onDelete: Restrict` on `AccountLedgerEntry.account`, `DrawerTransaction.drawer`, and `SaleLineSerial.serialUnit`.
   - Add `outletId` to `AccountLedgerEntry` for multi-outlet GL isolation.
   - Add composite indexes on `SerialUnit(productId, outletId, status)`, `Sale(outletId, isQuotation, createdAt)`, `PurchaseOrder(outletId, status, createdAt)`, `BankTransaction(bankAccountId, transactionAt, id)`, `AccountLedgerEntry(accountId, createdAt)`, and `AuditLog(action, entityId, createdAt)`.
   - Batch N+1 queries in `executeFixedAssetDepreciation` (`lib/actions/fixed-assets.ts:590-610`).

### Phase 6 — POS Terminal State, Client Math, Ergonomics & Print Layout Fixes (Commit 6)
1. **`components/sales-terminal/checkout-dialog.tsx` & `components/sales-terminal/product-browser.tsx`:**
   - Synchronize `taxRatePct` in `CheckoutDialog`, update the 6xl Zone 1 banner (`line 611`) to display `৳{total.toFixed(2)}`, cap Order Discount at `netSubtotal`, and trigger a `ProductBrowser` re-fetch after every completed sale (`refreshKey`).
   - Add `include: { group: true }` to `getCustomerById` (`lib/actions/crm.ts:261-269`) and preserve custom `unitPrice` when incrementing serialized items (`components/sales-terminal/index.tsx:152-155`).
2. **`components/receipt/a4-invoice.tsx` & `components/receipt/thermal-receipt.tsx`:**
   - Add `Discount` and `Grand Total` rows to `SalesInvoiceLayout`'s `tfoot` (`components/receipt/a4-invoice.tsx:684-743`).
   - Add `className="thermal-receipt"`, serial numbers, warranty expiry, and `Balance Due` to `ThermalReceipt` (`components/receipt/thermal-receipt.tsx:117, 209-336`).
   - Guard global `Esc` hotkey when inputs/dialogs are focused and add `Enter`-to-select in `SerialSlotPicker`.

