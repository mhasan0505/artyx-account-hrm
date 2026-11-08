'use server'

import { requireAuth, requireRole } from '@/lib/actions/auth-guard'
import { logAudit } from '@/lib/audit/logger'
import { prisma } from '@/lib/db'
import { UserRole } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

function ok<T>(data: T) {
  return { success: true as const, data }
}

function fail(error: string) {
  return { success: false as const, error }
}

const nameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
})

const renameSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().trim().min(1, 'Name is required'),
})

const designationSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required'),
  departmentId: z.string().min(1, 'Department is required'),
})

export type MasterSetupCounts = {
  categories: number
  subcategories: number
  brands: number
  parents: number
  processors: number
  processorGens: number
  ram: number
  storage: number
  customerGroups: number
  discountLimits: number | null
  paymentMethods: number
  taxRates: number
  bankAccounts: number
  chartOfAccounts: number
  departments: number
  designations: number
  storeSettings: number
  letterhead: number | null
  users: number
  hardware: number | null
  auditLogs: number
}

/**
 * Returns record counts for all master setup cards.
 * Role-checked: accessible to authorized staff.
 */
export async function getMasterSetupCounts(): Promise<MasterSetupCounts> {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.HR
  )

  const [
    categories,
    subcategories,
    brands,
    parents,
    processors,
    processorGens,
    ram,
    storage,
    customerGroups,
    paymentMethods,
    taxRates,
    bankAccounts,
    chartOfAccounts,
    departments,
    designations,
    storeSettings,
    users,
    auditLogs,
  ] = await Promise.all([
    prisma.category.count().catch(() => 0),
    prisma.subCategory.count().catch(() => 0),
    prisma.brand.count().catch(() => 0),
    prisma.parentProduct.count().catch(() => 0),
    prisma.processor.count().catch(() => 0),
    prisma.processorGen.count().catch(() => 0),
    prisma.ram.count().catch(() => 0),
    prisma.storage.count().catch(() => 0),
    prisma.customerGroup.count().catch(() => 0),
    prisma.paymentMethodConfig.count().catch(() => 0),
    prisma.taxRate.count().catch(() => 0),
    prisma.bankAccount.count().catch(() => 0),
    prisma.chartOfAccount.count().catch(() => 0),
    prisma.department.count().catch(() => 0),
    prisma.designation.count().catch(() => 0),
    prisma.setting.count().catch(() => 0),
    prisma.user.count().catch(() => 0),
    prisma.auditLog.count().catch(() => 0),
  ])

  return {
    categories,
    subcategories,
    brands,
    parents,
    processors,
    processorGens,
    ram,
    storage,
    customerGroups,
    discountLimits: null, // Config settings page (no record count)
    paymentMethods,
    taxRates,
    bankAccounts,
    chartOfAccounts,
    departments,
    designations,
    storeSettings,
    letterhead: null, // Template configuration (no record count)
    users,
    hardware: null, // Device interface page (no record count)
    auditLogs,
  }
}

/**
 * Returns read-only chart of accounts list ordered by account code.
 * Role-checked: SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTANT.
 */
export async function getChartOfAccountsList() {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )

  return prisma.chartOfAccount.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isActive: true,
    },
    orderBy: { code: 'asc' },
  })
}

export async function updateChartOfAccountName(id: string, name: string) {
  await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT
  )
  const cleanName = name.trim()
  if (!cleanName) return fail('Account name is required')

  const account = await prisma.chartOfAccount.update({
    where: { id },
    data: { name: cleanName },
  })

  revalidatePath('/master-setup/chart-of-accounts')
  revalidatePath('/master-setup')
  return ok({ id: account.id, name: account.name })
}

// ─────────────────────────────────────────────
// PROCESSOR
// ─────────────────────────────────────────────

export async function getProcessorsList() {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  return prisma.processor.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { products: true } },
    },
  })
}

export async function createProcessorAction(name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = nameSchema.safeParse({ name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const trimmed = parsed.data.name
  const existing = await prisma.processor.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  })
  if (existing) return fail('Processor already exists')

  const created = await prisma.processor.create({ data: { name: trimmed } })
  await logAudit('CREATE', 'Processor', created.id, {
    name: trimmed,
    createdById: user.id,
  })
  revalidatePath('/master-setup/processors')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(created)
}

export async function updateProcessor(id: string, name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = renameSchema.safeParse({ id, name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.processor.findUnique({ where: { id: parsed.data.id } })
  if (!existing) return fail('Processor not found')

  const trimmed = parsed.data.name
  const duplicate = await prisma.processor.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      id: { not: parsed.data.id },
    },
  })
  if (duplicate) return fail('Processor with this name already exists')

  const updated = await prisma.processor.update({
    where: { id: parsed.data.id },
    data: { name: trimmed },
  })
  await logAudit('RENAME', 'Processor', updated.id, {
    oldName: existing.name,
    newName: trimmed,
    updatedById: user.id,
  })
  revalidatePath('/master-setup/processors')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(updated)
}

// ─────────────────────────────────────────────
// PROCESSOR GENERATION
// ─────────────────────────────────────────────

export async function getProcessorGensList() {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  return prisma.processorGen.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { products: true } },
    },
  })
}

export async function createProcessorGenAction(name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = nameSchema.safeParse({ name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const trimmed = parsed.data.name
  const existing = await prisma.processorGen.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  })
  if (existing) return fail('Processor Generation already exists')

  const created = await prisma.processorGen.create({ data: { name: trimmed } })
  await logAudit('CREATE', 'ProcessorGen', created.id, {
    name: trimmed,
    createdById: user.id,
  })
  revalidatePath('/master-setup/processor-generations')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(created)
}

export async function updateProcessorGen(id: string, name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = renameSchema.safeParse({ id, name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.processorGen.findUnique({
    where: { id: parsed.data.id },
  })
  if (!existing) return fail('Processor Generation not found')

  const trimmed = parsed.data.name
  const duplicate = await prisma.processorGen.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      id: { not: parsed.data.id },
    },
  })
  if (duplicate) return fail('Processor Generation with this name already exists')

  const updated = await prisma.processorGen.update({
    where: { id: parsed.data.id },
    data: { name: trimmed },
  })
  await logAudit('RENAME', 'ProcessorGen', updated.id, {
    oldName: existing.name,
    newName: trimmed,
    updatedById: user.id,
  })
  revalidatePath('/master-setup/processor-generations')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(updated)
}

// ─────────────────────────────────────────────
// RAM
// ─────────────────────────────────────────────

export async function getRamList() {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  return prisma.ram.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { products: true } },
    },
  })
}

export async function createRamAction(name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = nameSchema.safeParse({ name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const trimmed = parsed.data.name
  const existing = await prisma.ram.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  })
  if (existing) return fail('RAM option already exists')

  const created = await prisma.ram.create({ data: { name: trimmed } })
  await logAudit('CREATE', 'Ram', created.id, {
    name: trimmed,
    createdById: user.id,
  })
  revalidatePath('/master-setup/ram')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(created)
}

export async function updateRam(id: string, name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = renameSchema.safeParse({ id, name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.ram.findUnique({ where: { id: parsed.data.id } })
  if (!existing) return fail('RAM option not found')

  const trimmed = parsed.data.name
  const duplicate = await prisma.ram.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      id: { not: parsed.data.id },
    },
  })
  if (duplicate) return fail('RAM option with this name already exists')

  const updated = await prisma.ram.update({
    where: { id: parsed.data.id },
    data: { name: trimmed },
  })
  await logAudit('RENAME', 'Ram', updated.id, {
    oldName: existing.name,
    newName: trimmed,
    updatedById: user.id,
  })
  revalidatePath('/master-setup/ram')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(updated)
}

// ─────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────

export async function getStorageList() {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  return prisma.storage.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { products: true } },
    },
  })
}

export async function createStorageAction(name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = nameSchema.safeParse({ name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const trimmed = parsed.data.name
  const existing = await prisma.storage.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  })
  if (existing) return fail('Storage option already exists')

  const created = await prisma.storage.create({ data: { name: trimmed } })
  await logAudit('CREATE', 'Storage', created.id, {
    name: trimmed,
    createdById: user.id,
  })
  revalidatePath('/master-setup/storage')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(created)
}

export async function updateStorage(id: string, name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  )
  const parsed = renameSchema.safeParse({ id, name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.storage.findUnique({
    where: { id: parsed.data.id },
  })
  if (!existing) return fail('Storage option not found')

  const trimmed = parsed.data.name
  const duplicate = await prisma.storage.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      id: { not: parsed.data.id },
    },
  })
  if (duplicate) return fail('Storage option with this name already exists')

  const updated = await prisma.storage.update({
    where: { id: parsed.data.id },
    data: { name: trimmed },
  })
  await logAudit('RENAME', 'Storage', updated.id, {
    oldName: existing.name,
    newName: trimmed,
    updatedById: user.id,
  })
  revalidatePath('/master-setup/storage')
  revalidatePath('/master-setup')
  revalidatePath('/create-products')
  return ok(updated)
}

// ─────────────────────────────────────────────
// DEPARTMENT
// ─────────────────────────────────────────────

export async function getDepartmentsList() {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR)
  return prisma.department.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { employees: true, designations: true } },
    },
  })
}

export async function createDepartmentAction(name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.HR
  )
  const parsed = nameSchema.safeParse({ name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const trimmed = parsed.data.name
  const existing = await prisma.department.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  })
  if (existing) return fail('Department already exists')

  const created = await prisma.department.create({ data: { name: trimmed } })
  await logAudit('CREATE', 'Department', created.id, {
    name: trimmed,
    createdById: user.id,
  })
  revalidatePath('/master-setup/departments')
  revalidatePath('/master-setup')
  revalidatePath('/hr/employees')
  return ok(created)
}

export async function updateDepartment(id: string, name: string) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.HR
  )
  const parsed = renameSchema.safeParse({ id, name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.department.findUnique({
    where: { id: parsed.data.id },
  })
  if (!existing) return fail('Department not found')

  const trimmed = parsed.data.name
  const duplicate = await prisma.department.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      id: { not: parsed.data.id },
    },
  })
  if (duplicate) return fail('Department with this name already exists')

  const updated = await prisma.department.update({
    where: { id: parsed.data.id },
    data: { name: trimmed },
  })
  await logAudit('RENAME', 'Department', updated.id, {
    oldName: existing.name,
    newName: trimmed,
    updatedById: user.id,
  })
  revalidatePath('/master-setup/departments')
  revalidatePath('/master-setup')
  revalidatePath('/hr/employees')
  return ok(updated)
}

// ─────────────────────────────────────────────
// DESIGNATION
// ─────────────────────────────────────────────

export async function getDesignationsList() {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR)
  return prisma.designation.findMany({
    orderBy: { name: 'asc' },
    include: {
      department: { select: { id: true, name: true } },
      _count: { select: { employees: true } },
    },
  })
}

export async function createDesignationAction(
  name: string,
  departmentId: string
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.HR
  )
  const parsed = designationSchema.safeParse({ name, departmentId })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const dept = await prisma.department.findUnique({
    where: { id: parsed.data.departmentId },
  })
  if (!dept) return fail('Department not found')

  const trimmed = parsed.data.name
  const existing = await prisma.designation.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      departmentId: parsed.data.departmentId,
    },
  })
  if (existing) return fail('Designation already exists in this department')

  const created = await prisma.designation.create({
    data: { name: trimmed, departmentId: parsed.data.departmentId },
  })
  await logAudit('CREATE', 'Designation', created.id, {
    name: trimmed,
    departmentId: parsed.data.departmentId,
    createdById: user.id,
  })
  revalidatePath('/master-setup/designations')
  revalidatePath('/master-setup')
  revalidatePath('/hr/employees')
  return ok(created)
}

export async function updateDesignation(
  id: string,
  name: string,
  departmentId?: string
) {
  const user = await requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.HR
  )
  const parsed = renameSchema.safeParse({ id, name })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const existing = await prisma.designation.findUnique({
    where: { id: parsed.data.id },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  })
  if (!existing) return fail('Designation not found')

  // Reject department change when designation has assigned employees
  if (departmentId && departmentId !== existing.departmentId) {
    if (existing._count.employees > 0) {
      return fail('Cannot change department for a designation with assigned employees')
    }
  }

  const targetDeptId = departmentId || existing.departmentId
  const trimmed = parsed.data.name
  const duplicate = await prisma.designation.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      departmentId: targetDeptId,
      id: { not: parsed.data.id },
    },
  })
  if (duplicate)
    return fail('Designation with this name already exists in this department')

  const updated = await prisma.designation.update({
    where: { id: parsed.data.id },
    data: { name: trimmed, departmentId: targetDeptId },
  })
  await logAudit('RENAME', 'Designation', updated.id, {
    oldName: existing.name,
    newName: trimmed,
    departmentId: targetDeptId,
    updatedById: user.id,
  })
  revalidatePath('/master-setup/designations')
  revalidatePath('/master-setup')
  revalidatePath('/hr/employees')
  return ok(updated)
}
