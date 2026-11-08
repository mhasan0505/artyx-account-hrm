# Deployment & Operations Runbook: Audit Fixes 6–14

This runbook outlines the required step-by-step procedure for deploying branch `fix/audit-6-10` to staging and production environments.

> [!IMPORTANT]
> Follow the numbered steps in strict chronological order. Do not skip pre-flight checks or backup steps.

---

## Pre-Deployment Sequence

### Step 1: Full Database Backup
Before applying schema migrations or maintenance scripts, take an immediate, full snapshot of the production PostgreSQL database:

```bash
# Example via pg_dump
pg_dump -U <username> -d <dbname> -F c -b -v -f "backup_pre_audit_fixes_$(date +%Y%m%d_%H%M%S).dump"

# Or using the repository backup utility
pnpm tsx scripts/full-database-backup.ts
```

---

### Step 2: Verify Chart of Accounts (COA) Integrity (Read-Only)
Verify that all system accounts required for operational journal posting, discount reconciliation, and fee expense allocation are present in the database:

```bash
pnpm tsx scripts/check-coa.ts
```

- **Accounts Checked:** `1100` (Cash on Hand), `1200` (Bank Accounts), `1300` (Accounts Receivable), `1400` (Inventory Asset), `2300` (VAT / Tax Payable), `4100` (Sales Revenue), `5000` (Cost of Goods Sold), `5290` (Bank / MFS Fee Expense).
- **Behavior:** This script is strictly read-only. It reports `[PASS]` or `[FAIL]` per account and exits with non-zero status if any account is missing. Do not proceed until all 8 accounts pass.

---

### Step 3: Stock-Layer Drift Check on Real Data
Audit FIFO inventory layers and stock ledgers across all products and outlets:

```bash
pnpm tsx scripts/check-stock-layer-drift.ts
```

> [!NOTE]
> **Fix 5 (FIFO Inventory Integrity & Accurate COGS)** depends on zero drift between `StockLedger` (cumulative movement sums) and `StockLayer` (unconsumed remaining layer quantities). If historical drift is identified, review and resolve the discrepancies prior to cutover.

---

### Step 4: Apply Database Migrations (`prisma migrate deploy`)
Deploy pending schema migrations using the Prisma CLI:

```bash
pnpm prisma migrate deploy
```

#### Migration Details:
- **Migration File:** `prisma/migrations/20260923180000_add_document_counter/migration.sql`
- **Table Created:** `"DocumentCounter"`
  ```sql
  CREATE TABLE "DocumentCounter" (
      "id" TEXT NOT NULL,
      "docType" TEXT NOT NULL,
      "value" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("id")
  );
  CREATE UNIQUE INDEX "DocumentCounter_docType_key" ON "DocumentCounter"("docType");
  ```
- **Counter Invariant:** The database column `"value"` defaults to `0` (not `1`). When a new document type is first encountered, `nextDocumentNumber(tx, docType)` performs an atomic increment (`value: { increment: 1 }`), advancing the counter to `1` and formatting the document code as `0001` (e.g., `SAL0001`, `QTN0001`, `RTN0001`, `PO0001`, `PINV0001`, `PRTN0001`, `SVC0001`, `SINV0001`, `IRP0001`, `BINV0001`). No manual seeding is required or allowed.

---

### Step 5: Place Cambria Fonts & Generate Base64 Module
To enable Cambria typography in client-side and server-side PDF exports, place font files and compile the base64 asset before building:

1. Place the licensed TrueType font files into `lib/pdf/fonts/`:
   - `lib/pdf/fonts/cambria-regular.ttf`
   - `lib/pdf/fonts/cambria-bold.ttf`

2. Run the base64 compilation script:
   ```bash
   pnpm tsx scripts/generate-font-base64.ts
   ```
   - Compiles font binaries into `lib/pdf/fonts/cambria-base64.ts`.
   - The PDF generator (`setupPdfFont`) dynamically imports this module and falls back to standard `times` font if fonts are omitted.
   - **Important:** This module is compiled directly into the Next.js bundle during `pnpm build`. If fonts are added or updated at a later date, rebuild the application (`pnpm build`) to incorporate them.

---

### Step 6: Environment Variables & Walk-in Customer Setup
1. **Configure Environment Variables:**
   Ensure `NEXT_PUBLIC_APP_URL` is configured in `.env.local` / production environment (e.g., `https://pos.yourcompany.com`).
   - `NEXT_PUBLIC_APP_URL` **is required** for public invoice viewing, customer receipt verification links, and secure tokenized PDF sharing.

2. **Run Walk-in Customer Linker:**
   Link the default walk-in customer record to system settings and verify its presence:
   ```bash
   pnpm tsx scripts/set-walk-in-setting.ts
   ```
   - Verifies that a valid Walk-in Customer exists in the `Customer` table.
   - Upserts the setting key `walk_in_customer_id` into the `Setting` table.

---

### Step 7: Build & Deploy Application
Build and start the application server:

```bash
pnpm build
pm2 restart ecosystem.config.js
```

> [!NOTE]
> Rebuild with `pnpm build` whenever font files in `lib/pdf/fonts/` or client-exposed environment variables are modified.

Verify service readiness via the health check endpoint:
```bash
curl -f http://localhost:3000/api/health/db
```

---

## Post-Deployment Sequence

### Step 8: Manager PINs Setup & Discount Limit Review
1. **PIN Configuration:**
   Each manager and administrator must log into the system and configure their personal 4–8 digit authorization PIN in their Profile / HR section.
   - PINs are securely hashed using bcrypt (`User.pin`).
   - Self-approval is strictly rejected (a user cannot approve their own discount or return).
   - **Brute-Force Lockout:** Failed PIN verification attempts are recorded in `AuditLog` under action `DISCOUNT_OVERRIDE_FAILED` (for discount overrides) and `RETURN_APPROVAL_FAILED` (for return manager approvals). Lockout is evaluated directly by counting recent failures in `AuditLog` within a 15-minute rolling window (>= 5 failures locks out the manager for 15 minutes), ensuring persistence across server restarts and multiple process workers (not stored in ephemeral process memory).

2. **Discount Limit Policy Review:**
   Super Admins must review role-based discount threshold limits under **Settings > Discounts** (`/settings/discounts`).

---

### Step 9: Audit Historic Unbalanced Journals (Read-Only)
Run a read-only audit to identify legacy sales transactions where debits and credits do not balance due to past payment gateway fee allocations:

```bash
pnpm tsx scripts/find-unbalanced-journals.ts
```

- This script performs zero database writes.
- Analyzes all sales with bank payments and prints detailed debit/credit variance diagnostics.
- **Cash Report Reconciliation Note:** The "All Banks Total vs GL 1200" row on the Cash Report (`/reports/cash`) will report a variance until `correct-sale-fee-journals.ts` runs. Additionally, pre-period unassigned bank payments will also appear as variances in this row until reconciled or back-posted.

---

### Step 10: Rebalance Fee Journals (`correct-sale-fee-journals.ts`)
If unbalanced sale journals from legacy fee allocation were found in Step 9, rebalance them using `correct-sale-fee-journals.ts`.

> [!IMPORTANT]
> **Scripts have no `--dry-run` flag: dry run is the DEFAULT mode.** Running without `--confirm` will only simulate adjustments and print a preview without modifying the database.

1. **Run Default Dry Run (Preview):**
   ```bash
   pnpm tsx scripts/correct-sale-fee-journals.ts
   ```

2. **Accountant Decision on `--post-date`:**
   Consult with the organization's accountant before applying corrections:
   - `--post-date=today` (**Recommended for GAAP / Audit compliance**): Posts adjusting entries as of today's date. Preserves the financial closure of past periods so prior tax returns and finalized financial statements remain unchanged.
   - `--post-date=original`: Backdates adjusting entries to the sale's original `createdAt` date. Achieves historical entry symmetry but modifies historical trial balance reports in closed periods.

3. **Execute Live Correction (Only with `--confirm`):**
   ```bash
   # Execute with chosen post-date mode:
   pnpm tsx scripts/correct-sale-fee-journals.ts --confirm --post-date=today
   ```

---

### Step 11: Purge Legacy Shared Override PIN (`remove-legacy-override-pin.ts`)
With per-manager bcrypt PINs active, purge the legacy plaintext `manager_override_pin` row from the `Setting` table.

1. **Run Default Dry Run (Preview):**
   ```bash
   pnpm tsx scripts/remove-legacy-override-pin.ts
   ```

2. **Execute Live Deletion (Only with `--confirm`):**
   ```bash
   pnpm tsx scripts/remove-legacy-override-pin.ts --confirm
   ```
