# Database Reset Script

## Purpose

This script clears all transactional and operational data from the database while preserving products and essential system configuration. This is useful for giving clients a fresh start while keeping their product catalog intact.

## What Gets DELETED ❌

### Transactional Data

- All sales and sale returns
- All purchases and purchase orders
- All invoices and payments
- All quotations
- All service jobs

### Customer & Supplier Data

- All customers and customer groups
- All suppliers
- All customer/supplier ledger entries

### Stock & Inventory

- All serial numbers
- All stock movements and adjustments
- All stock transfers
- Stock ledger history

### Financial Data

- All cash drawer sessions
- All bank accounts and transactions
- All expenses
- All contra transfers
- All cheques
- All chart of accounts and ledger entries

### HR & Payroll

- All employees
- All departments and designations
- All salary components
- All attendance records
- All leave requests and balances
- All payroll and payslips

### Audit & Logs

- All audit logs
- All edit history logs

## What Gets PRESERVED ✅

### Products & Catalog

- All products
- Categories and subcategories
- Brands
- Processors, RAM, Storage configurations
- Parent products

### System Configuration

- Outlets
- Tax rates
- Payment method configurations
- System settings
- Admin users (non-admin users are removed)

## How to Run

### Method 1: Using npm script (Recommended)

```bash
pnpm db:reset
```

### Method 2: Direct execution

```bash
pnpm tsx scripts/reset-database.ts
```

## Safety Features

1. **5-second delay**: The script waits 5 seconds before executing to allow you to cancel with `Ctrl+C`
2. **Confirmation message**: Shows exactly what will be deleted
3. **Progress tracking**: Shows each table being cleared
4. **Summary report**: Shows what was preserved and deleted

## After Reset

The script will:

- Keep at least one SUPER_ADMIN user (creates one if none exists)
- Preserve all your products
- Reset to a clean operational state
- Display a summary of what was retained

## Example Output

```
🗑️  Starting database reset...

⚠️  WARNING: This will DELETE all transactional data!
✅ Products, Categories, Brands, and System Config will be PRESERVED

Deleting transactional and operational data...
  ✓ AuditLog
  ✓ SaleEditLog
  ✓ PurchaseInvoiceEditLog
  ... (continues for all tables)

Resetting users...
  ✓ Deleted non-admin users
  ✓ Admin user preserved

✅ Database reset complete!

📦 Products retained: 245
📁 Categories retained: 12
🏷️  Brands retained: 18
```

## Use Cases

- **Fresh Start**: Client wants to clear test/training data
- **Clean Slate**: Reset system after implementation/testing phase
- **Archive & Reset**: Before starting a new fiscal year (after backing up)
- **Demo Reset**: Restore demo environment to clean state

## ⚠️ IMPORTANT WARNINGS

1. **IRREVERSIBLE**: This operation CANNOT be undone
2. **BACKUP FIRST**: Always create a database backup before running
3. **PRODUCTION**: Use extreme caution in production environments
4. **VERIFY**: Double-check you're connected to the correct database

## Creating a Backup First

```bash
# PostgreSQL backup
pg_dump -h hostname -U username -d database_name > backup_$(date +%Y%m%d_%H%M%S).sql

# Or use your VPS backup tools
```

## Restore from Backup

```bash
# If you need to restore
psql -h hostname -U username -d database_name < backup_file.sql
```
