# Purchase & Sales Return System — Audit Report
> Generated: 2026-09-03 · Files reviewed: `prisma/schema.prisma`, `lib/actions/purchases.ts`, `lib/actions/sales.ts`, `lib/actions/products.ts`, `lib/actions/ap-ar.ts`, `app/(app)/purchases/returns/`, `app/(app)/sales-orders/returns/`

---

## 🔴 BUGS (Real Functional Issues)

### Bug 1 — `createPurchaseReturn`: `PurchaseInvoice` is never updated & `purchaseInvoiceId` is left `null`
**Files:** [`purchases.ts:2674–2701`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/purchases.ts#L2674-L2701), [`schema.prisma:881`](file:///d:/ARTYX%20DIGITAL/2026/prisma/schema.prisma#L881)

```ts
// CURRENT (broken link & missing update)
const ret = await activeTx.purchaseReturn.create({
  data: {
    returnNumber,
    purchaseOrderId: po.id,
    supplierId: po.supplierId,
    // purchaseInvoiceId is never set!
    notes: trimmedReason,
    settlementMethod: settlement,
    ...
  }
})
```

- When a purchase order is created, an invoice is generated (`PurchaseInvoice`).
- In `createPurchaseReturn`, `purchaseInvoiceId` is never queried, set, or linked on `PurchaseReturn`.
- More critically: **the `PurchaseInvoice` record is never updated**.
- If the original invoice was for ৳100,000 and ৳30,000 worth of merchandise is returned, the invoice remains in `status: DRAFT` or `PARTIALLY_PAID` with total ৳100,000.
- When `settlementMethod === 'AP_REDUCTION'` executes, `supplier.outstandingBalance` decreases by ৳30,000, but the invoice still displays `due: ৳100,000` on AP / invoice lists. This creates an irreconcilable discrepancy between the supplier's total balance and open invoice balances.

**Fix:** Query the PO's associated `PurchaseInvoice`, link `purchaseInvoiceId: invoice.id`, and adjust the invoice's total/balance or record an invoice credit note adjustment.

---

### Bug 2 — `RETURN_OUT` StockLedger entry omits `referenceId`
**File:** [`purchases.ts:2636–2647`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/purchases.ts#L2636-L2647) vs [`products.ts:3456–3464`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/products.ts#L3456-L3464)

```ts
// CURRENT in purchases.ts
await activeTx.stockLedger.create({
  data: {
    productId: poLine.productId,
    outletId: po.outletId,
    supplierId: po.supplierId,
    purchaseOrderId: po.id,
    movementType: StockMovementType.RETURN_OUT,
    quantity: -reqLine.quantity,
    referenceType: 'PurchaseReturn',
    notes: `Purchase Return ${returnNumber}`,
    // referenceId is MISSING!
  },
})
```

Because `ret` is created *after* stock layers are consumed, `referenceId` is omitted.
In [`products.ts:3457`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/products.ts#L3457):
```ts
for (const row of ledgerRows) {
  if (!row.referenceId) continue // Silently skips rows without referenceId!
```
In the Product Ledger and Stock History reports, any `RETURN_OUT` entry is skipped during document enrichment. The supplier name renders as `"Unknown"`, and clicking the ledger item fails to navigate to the debit note.

**Fix:** Generate `ret.id` (e.g. with `cuid()`) or create the `purchaseReturn` record first, then pass `referenceId: ret.id`.

---

### Bug 3 — Sales Return: `DEAD` and `IN_SERVICE` serials falsely inflate available inventory in `StockLedger`
**File:** [`sales.ts:1470–1479`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/sales.ts#L1470-L1479) & [`sales.ts:1536–1551`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/sales.ts#L1536-L1551)

```ts
// CURRENT
await tx.stockLedger.create({
  data: {
    productId: saleLine.productId,
    outletId: sale.outletId,
    movementType: StockMovementType.RETURN_IN,
    quantity: reqLine.quantity, // FULL quantity (e.g. +2)
    referenceId: ret.id,
    referenceType: 'SaleReturn',
  },
})

// Serials updated:
for (const serialUpdate of serialsToUpdate) {
  await tx.serialUnit.update({
    where: { id: serialUpdate.serialUnitId },
    data: { status: serialUpdate.qualityStatus }, // could be DEAD or IN_SERVICE
  })
}
```

- When a customer returns 2 units (e.g. 1 resellable `IN_STOCK` and 1 scrap `DEAD`), `StockLedger` receives `+2` sellable stock.
- The `DEAD` unit is excluded from `StockLayer` (correct), but `StockLedger.quantity` is increased for both units.
- Any calculation based on `StockLedger` (like available branch stock, valuation, or daily reports) now counts the dead unit as available physical stock.

**Fix:** Only increment `StockLedger` for items marked `IN_STOCK`, OR immediately post an offsetting `ADJUSTMENT_OUT` for `DEAD` units (mirroring [`products.ts:1750`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/products.ts#L1750)).

---

### Bug 4 — `processSaleReturn`: Bank refund silently skips balance deduction if original payment has no `bankAccountId`
**File:** [`sales.ts:1747–1762`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/sales.ts#L1747-L1762)

```ts
if (bankRefundAmount > 0) {
  const bankPayments = salePaymentRows.filter(
    p => p.method !== 'CASH' && p.method !== 'CREDIT' && p.bankAccountId
  )
  // If bankPayments is empty (e.g. bankAccountId was null on a card/MFS sale):
  for (const payment of bankPayments) { // NEVER RUNS!
    ...
  }
}
```

If a sale was settled with a non-cash method where `bankAccountId` was not captured:
1. `bankPayments` is an empty array.
2. The deduction loop never runs.
3. No `BankAccount` balance is reduced, and no `BankTransaction` is recorded.
4. However, the general ledger has already posted `Cr Bank Asset (1200)` for the full `bankRefundAmount`!
5. This creates an immediate silent drift between the General Ledger trial balance and actual bank account balances.

**Fix:** If `bankPayments.length === 0`, fall back to a user-specified bank account, OR validate and fail loudly if no valid bank account can be resolved for the refund.

---

### Bug 5 — `createPurchaseReturn`: Crashes on FIFO error if items from the PO were already sold
**File:** [`purchases.ts:2610–2634`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/purchases.ts#L2610-L2634) vs [`purchases.ts:2960–2991`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/purchases.ts#L2960-L2991)

- `getPurchaseReturnPreview` accurately checks available layer stock (`quantityRemaining`) and in-stock serials to determine `maxReturnableQty`.
- But `createPurchaseReturn` only checks:
  ```ts
  const remaining = poLine.quantity - alreadyReturned
  if (line.quantity > remaining) throw ...
  ```
- If 5 units were bought and 4 were already sold to retail customers, `remaining` is still 5.
- `createPurchaseReturn` proceeds to call `consumeStockLayers` for 5 units targeted at that PO, which throws an internal error: `Insufficient FIFO layer stock available... (needed 5, found 1)`.
- The user sees an unhandled server error crash instead of a clean validation response.

**Fix:** Validate physical availability (`quantityRemaining` for non-serialized, `IN_STOCK` count for serialized) under transaction lock before calling `consumeStockLayers`.

---

## 🟡 DESIGN MISMATCHES / LOGIC GAPS

### Mismatch 1 — Non-serialized Sales Returns cannot specify return condition
**File:** [`app/(app)/sales-orders/returns/create/page.tsx`](file:///d:/ARTYX%20DIGITAL/2026/app/%28app%29/sales-orders/returns/create/page.tsx)

Serialized products allow selecting `Resellable (IN_STOCK)`, `Needs Service (IN_SERVICE)`, or `Dead (DEAD)`.
Non-serialized items have no condition selector — they are always assumed 100% resellable and re-enter FIFO `StockLayer`. If a customer returns a defective cable, adapter, or mouse, there is no way to return it directly as scrap/faulty.

---

### Mismatch 2 — Sales Return AR deduction forces Customer balance negative if previously paid
**File:** [`sales.ts:1410–1416`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/sales.ts#L1410-L1416), [`sales.ts:1627–1630`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/sales.ts#L1627-L1630)

`processSaleReturn` calculates `unpaidDueInSale = total - amountPaid` using the snapshot on `Sale`.
If the customer had a ৳5,000 credit sale on Monday, paid off the ৳5,000 due on Tuesday via Account Collection, and returns the item on Wednesday:
- `processSaleReturn` still treats ৳5,000 as unpaid AR.
- It deducts ৳5,000 from `customer.outstandingBalance`, pushing the customer into negative debt (-৳5,000).
- The customer only receives a partial or zero liquid refund, even though they already paid in full.

**Fix:** Cap `arRefundAmount` by `Math.min(customerRefundTotal, totalCreditOnSale, customer.outstandingBalance)`. Any excess should be refunded in cash/bank or stored as explicit Store Credit.

---

### Mismatch 3 — Purchase Return `AP_REDUCTION` allows Supplier balance to become negative
**File:** [`purchases.ts:2720–2729`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/purchases.ts#L2720-L2729)

If a purchase was fully paid upfront (`supplier.outstandingBalance = 0`), processing a return with `AP_REDUCTION` unconditionally decrements `outstandingBalance`, leaving the supplier balance negative (Supplier owes us). The UI doesn't warn the user that there is no open AP balance to reduce and does not prompt them to select `CASH_REFUND`.

---

### Mismatch 4 — Multi-Outlet Super Admin Cash Drawer mismatch
**Files:** [`purchases.ts:2746`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/purchases.ts#L2746), [`sales.ts:1716`](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/sales.ts#L1716)

When a Super Admin processes a return:
```ts
const drawer = await tx.cashDrawer.findFirst({
  where: { outletId: sale.outletId, status: 'OPEN' },
})
```
It selects the drawer belonging to the **sale's original outlet**, not the **outlet where the admin is physically located**. If the admin is stationed at Outlet A returning an item originally sold at Outlet B, Outlet B's cash drawer is adjusted remotely.

---

### Mismatch 5 — Product links missing in Return Lists and Viewers (`bugs.md` #5)
**Files:** [`app/(app)/purchases/returns/columns.tsx`](file:///d:/ARTYX%20DIGITAL/2026/app/%28app%29/purchases/returns/columns.tsx), [`app/(app)/purchases/returns/[id]/return-doc-viewer.tsx`](file:///d:/ARTYX%20DIGITAL/2026/app/%28app%29/purchases/returns/%5Bid%5D/return-doc-viewer.tsx)

As noted in `bugs.md`:
> *"5. Purchase Return section: in purchase return page when i click the product id it should redirect to the product details page"*

Product names and IDs in the purchase return table and documents are currently static text without hyperlinks to `/products/[id]`.

---

## 🟢 WORKING CORRECTLY

| Feature | Status |
|---|---|
| Row-level locking on PO, Sale, Customer, Supplier, and Bank | ✅ Prevents concurrent over-returns |
| Idempotent return calculation (`groupBy` with line IDs) | ✅ Verified |
| Gift return cap (cannot return more gifts than parent items) | ✅ Implemented correctly |
| Proportional discount & VAT distribution on Sales Returns | ✅ Exact per-unit pricing refunded |
| Dual-entry GL postings for both Purchase and Sales returns | ✅ Balanced Debits = Credits |
| A4 Printable Debit Note & Return Challan generation | ✅ Implemented cleanly |
| Serial Status Transition (`RETURNED_TO_SUPPLIER`, `IN_STOCK`, `IN_SERVICE`, `DEAD`) | ✅ State machine enforced |

---

## Summary Table

| # | Severity | Location | Issue |
|---|---|---|---|
| Bug 1 | 🔴 | `purchases.ts:2674` | `PurchaseInvoice` is never updated or linked; causes AP ledger drift |
| Bug 2 | 🔴 | `purchases.ts:2636` | `StockLedger` entry omits `referenceId`; breaks ledger tracking |
| Bug 3 | 🔴 | `sales.ts:1470` | `DEAD`/`IN_SERVICE` serials inflate available stock in `StockLedger` |
| Bug 4 | 🔴 | `sales.ts:1747` | Bank refund skips deduction if payment lacks `bankAccountId`; GL drifts |
| Bug 5 | 🔴 | `purchases.ts:2610` | Crashes with internal FIFO error if PO units were previously sold |
| Mismatch 1 | 🟡 | `sales-orders/returns/create` | Non-serialized returns cannot specify condition/scrap |
| Mismatch 2 | 🟡 | `sales.ts:1410` | AR deduction forces customer balance negative if previously paid |
| Mismatch 3 | 🟡 | `purchases.ts:2720` | `AP_REDUCTION` allows supplier balance to drop below zero silently |
| Mismatch 4 | 🟡 | `purchases.ts:2746` & `sales.ts:1716` | Super Admin cash drawer targets original outlet, not active physical drawer |
| Mismatch 5 | 🟡 | `purchases/returns/columns.tsx` | Missing product redirect links to `/products/[id]` (`bugs.md` #5) |
