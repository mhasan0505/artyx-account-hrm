import fs from 'fs'
import path from 'path'
import { prisma } from 'd:/ARTYX DIGITAL/2026/lib/db'

async function main() {
  const migrationsDir = 'd:/ARTYX DIGITAL/2026/prisma/migrations'
  const migrationFolders = fs
    .readdirSync(migrationsDir)
    .filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory())
    .sort()

  const createdTables = new Map<string, string>() // table -> migrationFolder
  const alteredTables = new Map<string, string[]>() // table -> migrationFolders[]

  for (const folder of migrationFolders) {
    const sqlPath = path.join(migrationsDir, folder, 'migration.sql')
    if (!fs.existsSync(sqlPath)) continue
    const content = fs.readFileSync(sqlPath, 'utf8')

    // Find CREATE TABLE
    const createMatches = content.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi
    )
    for (const m of createMatches) {
      const table = m[1]
      if (!createdTables.has(table)) {
        createdTables.set(table, folder)
      }
    }

    // Find ALTER TABLE
    const alterMatches = content.matchAll(/ALTER\s+TABLE\s+["']?(\w+)["']?/gi)
    for (const m of alterMatches) {
      const table = m[1]
      if (!alteredTables.has(table)) {
        alteredTables.set(table, [])
      }
      alteredTables.get(table)!.push(folder)
    }
  }

  console.log('--- Migration Analysis ---')
  console.log('Total Created Tables across all migrations:', createdTables.size)

  // Check altered tables that were never created in any migration
  const alteredWithoutCreate: { table: string; migrations: string[] }[] = []
  for (const [table, migrations] of alteredTables.entries()) {
    if (!createdTables.has(table)) {
      alteredWithoutCreate.push({ table, migrations })
    }
  }
  console.log('Altered tables WITHOUT a CREATE TABLE in ANY migration:')
  console.log(JSON.stringify(alteredWithoutCreate, null, 2))

  // Live DB Tables
  const liveTablesRaw: any[] = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `
  const liveTables = liveTablesRaw.map(r => r.table_name)
  console.log('\nTotal Live DB Tables:', liveTables.length)

  const liveTablesWithoutMigrationCreate = liveTables.filter(
    t => t !== '_prisma_migrations' && !createdTables.has(t)
  )
  console.log(
    'Live DB Tables that have NO CREATE TABLE in any migration file:',
    liveTablesWithoutMigrationCreate
  )

  // Detailed schema of PayrollPayment
  console.log('\n--- PayrollPayment Columns ---')
  const ppCols: any[] = await prisma.$queryRaw`
    SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'PayrollPayment'
    ORDER BY ordinal_position;
  `
  console.log(JSON.stringify(ppCols, null, 2))

  console.log('\n--- PayrollPayment Constraints & Foreign Keys ---')
  const ppConstraints: any[] = await prisma.$queryRaw`
    SELECT
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'PayrollPayment';
  `
  console.log(JSON.stringify(ppConstraints, null, 2))

  console.log('\n--- PayrollPayment Indexes ---')
  const ppIndexes: any[] = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'PayrollPayment'
    ORDER BY indexname;
  `
  console.log(JSON.stringify(ppIndexes, null, 2))

  // Also check if any other table from liveTablesWithoutMigrationCreate needs inspection
  for (const t of liveTablesWithoutMigrationCreate) {
    if (t === 'PayrollPayment') continue
    console.log(`\n--- Schema for unmigrated table: ${t} ---`)
    const tCols: any[] = await prisma.$queryRaw`
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${t}
      ORDER BY ordinal_position;
    `
    console.log(JSON.stringify(tCols, null, 2))
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
