import { prisma } from '../lib/db'

/**
 * ==============================================================================
 * SCRIPT: remove-legacy-override-pin.ts
 * ==============================================================================
 * Removes the legacy shared plaintext `manager_override_pin` row from the Setting
 * table. Replaced by per-manager bcrypt PINs stored on User.pin (Fix 8).
 *
 * SAFETY INVARIANTS:
 * 1. Default mode is DRY-RUN: checks and prints current setting value without modifying.
 * 2. Deletes ONLY when explicit '--confirm' CLI argument is passed.
 * ==============================================================================
 */

async function main() {
  const args = process.argv.slice(2)
  const isConfirm = args.includes('--confirm')

  console.log('=== REMOVE LEGACY MANAGER OVERRIDE PIN SCRIPT ===')
  console.log(`Execution Mode: ${isConfirm ? '🔴 LIVE WRITE (--confirm)' : '🟢 DRY RUN (Read-Only Preview)'}`)
  console.log('Timestamp:', new Date().toISOString())

  const setting = await prisma.setting.findUnique({
    where: { key: 'manager_override_pin' },
  })

  if (!setting) {
    console.log('✅ Setting "manager_override_pin" does not exist in the database. Nothing to clean up.')
    return
  }

  console.log('Found legacy setting: key="manager_override_pin", value="[REDACTED]"')

  if (!isConfirm) {
    console.log('\n[DRY RUN COMPLETE] To permanently delete this row, re-run with: --confirm')
    return
  }

  console.log('\nExecuting deletion...')
  await prisma.setting.delete({
    where: { key: 'manager_override_pin' },
  })

  console.log('✅ Successfully removed legacy "manager_override_pin" from Setting table.')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async err => {
    console.error('Script failed:', err)
    await prisma.$disconnect()
    process.exit(1)
  })





  