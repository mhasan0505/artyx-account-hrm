
JULY Update -2026

1. Create Supplier profile-Done
2. Purchase-Done
3. HR
4. Products History
5. From fault to ReStock
6. Previous due not including in invoice both b2b and regular-Done
7. Purchase return and sales return
8. Address not showing in invoice -Done
9. Service Token
10. Invoice Edit option redirect to sales terminal
11. Single serial number box in purchase
12. Invoice QR
13. Navigation Panel- Done
14. Products Ledger. - Done


August Update 2026

1. pagination Done
2.


products create Page

1. If parents box doesnt need remove it. - Done
2. create another box called color , put it end of the products name - Done
3. After each feature row put a | so it look good - Done
4. Remove products price and price section - Done




Created check_drawer_12260.ts
Ran command: `npx tsx "C:\Users\Laptop Point BD\.gemini\antigravity-ide\brain\cb9a8456-326c-4b34-b6c5-121245152e5a\scratch\check_drawer_12260.ts"`
Used tool: manage_task
Viewed task-502.log
Used tool: manage_task
Viewed ap-ar.ts:860-950
Viewed ap-ar.ts:945-985
Viewed task-502.log
Used tool: manage_task
Used tool: manage_task
Edited check_drawer_12260.ts
Ran command: `npx tsx "C:\Users\Laptop Point BD\.gemini\antigravity-ide\brain\cb9a8456-326c-4b34-b6c5-121245152e5a\scratch\check_drawer_12260.ts"`
Viewed task-523.log
Viewed package.json:1-60
Viewed db.ts:1-60
Used tool: manage_task
Created check_drawer.ts
Ran command: `pnpm exec tsx scripts/check_drawer.ts`
Viewed task-536.log
Used tool: manage_task
Viewed reset-database.ts:1-60
Listed directory 2026
Used tool: manage_task
Edited check_drawer.ts
Ran command: `pnpm exec tsx scripts/check_drawer.ts`
Viewed task-553.log
Used tool: manage_task
Used tool: manage_task
Viewed .env.local:1-20
Created check_drawer.ts
Ran command: `pnpm exec tsx scripts/check_drawer.ts`
Viewed task-568.log
Created check_drawer.mjs
Used tool: manage_task
Ran command: `node scripts/check_drawer.mjs`
Viewed task-577.log
Used tool: manage_task
Ran command: `node -e "console.log('hello from node')"`
Viewed task-583.log
Used tool: manage_task
Used tool: manage_task
Used tool: manage_task
Searched for "drawerTransaction.create"
Viewed crm.ts:265-310
Viewed task-577.log
Read URL: http://localhost:3000/api/auth/session
Created route.ts
Read URL: http://localhost:3000/api/debug-drawer
Viewed content.md:1-7
Viewed cash-report.ts:80-140
Viewed finance.ts:60-105
Viewed finance.ts:470-520
Viewed finance.ts:530-600
Used tool: manage_task
Used tool: manage_task
Viewed cash-report.ts:115-142
Edited cash-report.ts
Ran command: `Remove-Item -Path "d:\ARTYX DIGITAL\2026\app\api\debug-drawer\route.ts", "d:\ARTYX DIGITAL\2026\scripts\check_drawer.ts", "d:\ARTYX DIGITAL\2026\scripts\check_drawer.mjs" -Force -ErrorAction SilentlyContinue`

I investigated the database and transaction history for **৳12,260**. Here is what was discovered:

---

### 1. Where Does ৳12,260 Come From?

`৳12,260` is the **Opening Balance carried forward from yesterday's closed session**.

When your current drawer was opened today at **08:38 AM**, the auto-open feature created an opening transaction:
- **Type**: `OPENING`
- **Amount**: `+৳12,260`
- **Description**: `"Auto-open: carried forward from previous closing balance"`

---

### 2. All 5 Transactions in Your Current Open Drawer

Your active cash drawer currently contains:

| # | Type | Amount | Note / Reference |
|---|---|---|---|
| 1 | **OPENING** | **+৳12,260** | Carried forward from previous day's close |
| 2 | **SALE** | **+৳216,000** | Sale `SAL-MTLAH3WV` |
| 3 | **SERVICE_PAYMENT** | **+৳9,500** | Service Invoice `SINV-MTLC04MN` |
| 4 | **CASH_OUT** | **-৳7,760** | *"Owner Received"* |
| 5 | **CASH_IN** | **+৳10,000** | *"Need Cash Balance"* |
| **Total** | **Expected Balance** | **৳240,000** | *(Without opening balance: ৳227,740)* |

---

### 3. The Double-Entry Bug Identified & Fixed

We discovered a **true double-counting bug in the Daily Cash Report** ([cash-report.ts](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/cash-report.ts#L115-L125)):

1. **How it happened:**
   - The report calculated `mainCashOpening` (opening balance of the day) by summing historical drawer transactions before today, which correctly equaled **৳12,260**.
   - Then, when summing today's cash inflows (`todayDrawerInflow`), it searched for all transactions where `amount > 0`.
   - Because the drawer was auto-opened today, its `OPENING` transaction (+৳12,260) was **counted a second time as today's cash inflow**!
   - This caused the Daily Cash Report to show **৳12,260 twice** (once in Opening Balance, and once in Today's Cash Inflows).

2. **The Fix Applied:**
   - In [lib/actions/cash-report.ts](file:///d:/ARTYX%20DIGITAL/2026/lib/actions/cash-report.ts#L120-L125), we added `NOT: { type: 'OPENING' }` to today's cash inflow query so starting balances are never double-counted as incoming operating cash.

---




  Few Changes In daily sales report

  - [x] 1. Change the name to Sales report.
  - [x] 2. Apply date range Start date to end date.
  - [x] 3. Apply numeric serial number.
  - [x] 4. Replace Serial Numbers with SKU/Code, position 3rd column.
  - [x] 5. Add discount column after sale price
  - [x] 6. Remove cash and credit column


Profit Loss Report Table column Tittle
- [x] Date
- [x] Products Name
- [x] Serial Number
- [x] QTY sold
- [x] Unit Cost
- [x] Other Cost
- [x] Discount
- [x] Unit Sale
- [x] Total Sale
- [x] Profit Per Unit
- [x] Total Profit

Discount Report

- [x] 1. Discount amount showing double , for example discount 30 in report showing 60


Questions I need answered first

Blank date and customer rows: are they extra items on the previous invoice, separate walk-in sales, or sales that share the date above? repalce those empty rows in daily sales report with the previous customer name with a line indicating that this is the same customer. do not repeat the whole row.

Payment method: where it's empty, should I treat the sale as cash, or can you give me a rule? Do any sales go to bank, bKash, or customer credit (unpaid)? Should the 12- and 13-unit business sales be treated as credit? Apply 10-15 percentage bank/bkash/cash rule.
July rates: what price should the 73 July rows use? Can you send the prices, or should I use each product's selling price in the system? i fixed it , if not do the best approach
August sheet: does it repeat any July rows (earliest date is 3 July), or are those lines new? make it such a way so there is no duplicates
Invoice grouping: should one row be one invoice, or should the same customer on the same day share one invoice? one sell one invoice. so multiple product in one invoice if show one time.
Stock: where purchase stock doesn't cover a sale, should I stop and list it for you, or allow negative stock? if stock is not available list for me
Customers and VAT: should I create any customers who aren't in the system yet? Are the rates VAT-inclusive, or is there no tax on these sales? create customer who are not listes, all price vat inclusive. there IS NO TAXES
Branch: do all sales go to the single main outlet, and is one cashier or employee name to be shown on the invoices? One branch


2|OsO5r67A5v9UK80hTtxLzvsPqJjmcVeJcobCVIqz944df759


Day boundary: midnight Asia/Dhaka (recommended), or the outlet's closeTime? daily midight
Daily physical count: optional, with auto-close at the expected balance (recommended), or required each morning? Optional
Multi-day gaps: one session per day (recommended), or a single session? one session per day
Opened-by on auto drawers: previous opener (recommended), or a dedicated System use previous opener
Handover button: keep it for cashier changes (recommended), remove it


need to fix

1.Gifts items stock not showing in sales terminal gift modal , its says out of stock.
2. In cart when choose same item multiple times it displays as multiple line keep it one line.
3. in serial choosing modal for products make it tikmark same as gift item.

