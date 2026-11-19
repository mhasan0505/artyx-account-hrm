'use server'

import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { CeoVaultCategory } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireCeoUser } from '@/lib/actions/money-management'
import { fail, ok, type ActionResult } from '@/lib/actions/result'
import {
  decryptBackupWithPassphrase,
  decryptVaultPayload,
  encryptBackupWithPassphrase,
  encryptVaultPayload,
  hasDedicatedVaultKey,
  signUnlockToken,
  verifyUnlockToken,
} from '@/lib/vault/crypto'
import { generateTotpCode } from '@/lib/vault/totp'
import { notifyExecutives } from '@/lib/notifications/executive-notifier'
import type {
  VaultAuditEntry,
  VaultCategory,
  VaultItemInput,
  VaultItemRevealed,
  VaultItemSummary,
  VaultSecretPayload,
} from '@/lib/vault/types'

const VAULT_COOKIE_NAME = 'ceo_vault_unlock'
const VAULT_PIN_KEY = 'ceo_vault_pin_hash'
const VAULT_LOCKOUT_KEY = 'ceo_vault_lockout'
const VAULT_UNLOCK_TTL_SECONDS = 10 * 60 // 10 minutes
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 5 * 60 * 1000 // 5 minutes

interface LockoutState {
  failedAttempts: number
  lockedUntil: number | null
}

function serializeSummary(item: {
  id: string
  title: string
  category: CeoVaultCategory
  folder: string
  provider: string | null
  loginUrl: string | null
  username: string | null
  host: string | null
  port: string | null
  tags: string[]
  isFavorite: boolean
  hasTotp: boolean
  hasSshKey: boolean
  lastRotatedAt: Date
  lastAccessedAt: Date | null
  createdAt: Date
  updatedAt: Date
}): VaultItemSummary {
  return {
    id: item.id,
    title: item.title,
    category: item.category as VaultCategory,
    folder: item.folder,
    provider: item.provider,
    loginUrl: item.loginUrl,
    username: item.username,
    host: item.host,
    port: item.port,
    tags: item.tags || [],
    isFavorite: item.isFavorite,
    hasTotp: item.hasTotp,
    hasSshKey: item.hasSshKey,
    lastRotatedAt: item.lastRotatedAt.toISOString(),
    lastAccessedAt: item.lastAccessedAt ? item.lastAccessedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

async function logVaultAudit(
  userId: string,
  action: string,
  entityId: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'CEO_VAULT',
        entityId,
        metadata: metadata ? (metadata as any) : undefined,
      },
    })
  } catch (err) {
    console.error('[VaultAudit] Failed to record audit log:', err)
  }
}

async function setUnlockCookie(userId: string): Promise<number> {
  const { token, expiresAt } = signUnlockToken(userId, VAULT_UNLOCK_TTL_SECONDS)
  const cookieStore = await cookies()
  cookieStore.set(VAULT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VAULT_UNLOCK_TTL_SECONDS,
  })
  return expiresAt
}

async function verifyVaultUnlocked(userId: string): Promise<{ unlocked: boolean; expiresAt?: number }> {
  const cookieStore = await cookies()
  const token = cookieStore.get(VAULT_COOKIE_NAME)?.value
  const result = verifyUnlockToken(token, userId)
  return { unlocked: result.valid, expiresAt: result.expiresAt }
}

async function getLockoutState(): Promise<LockoutState> {
  const setting = await prisma.setting.findUnique({ where: { key: VAULT_LOCKOUT_KEY } })
  if (!setting?.value) return { failedAttempts: 0, lockedUntil: null }
  try {
    return JSON.parse(setting.value) as LockoutState
  } catch {
    return { failedAttempts: 0, lockedUntil: null }
  }
}

async function saveLockoutState(state: LockoutState) {
  await prisma.setting.upsert({
    where: { key: VAULT_LOCKOUT_KEY },
    update: { value: JSON.stringify(state) },
    create: { key: VAULT_LOCKOUT_KEY, value: JSON.stringify(state) },
  })
}

/**
 * Returns current vault lock status & setup state for the CEO.
 */
export async function getVaultStatus(): Promise<
  ActionResult<{
    hasPinSet: boolean
    isUnlocked: boolean
    expiresAt: number | null
    hasDedicatedKey: boolean
    itemCount: number
  }>
> {
  const user = await requireCeoUser()
  const [pinSetting, itemCount, unlockCheck] = await Promise.all([
    prisma.setting.findUnique({ where: { key: VAULT_PIN_KEY } }),
    prisma.ceoVaultItem.count(),
    verifyVaultUnlocked(user.id!),
  ])

  return ok({
    hasPinSet: Boolean(pinSetting?.value),
    isUnlocked: unlockCheck.unlocked,
    expiresAt: unlockCheck.expiresAt ?? null,
    hasDedicatedKey: hasDedicatedVaultKey(),
    itemCount,
  })
}

/**
 * First-time setup of the personal CEO Vault PIN / Passphrase.
 */
export async function setupVaultPin(newPin: string): Promise<ActionResult<{ expiresAt: number }>> {
  const user = await requireCeoUser()
  const trimmed = newPin.trim()
  if (trimmed.length < 6) {
    return fail('Vault PIN or passphrase must be at least 6 characters.')
  }

  const existing = await prisma.setting.findUnique({ where: { key: VAULT_PIN_KEY } })
  if (existing?.value) {
    return fail('Vault PIN is already configured. Use Change PIN or Reset PIN instead.')
  }

  const hash = await bcrypt.hash(trimmed, 12)
  await prisma.setting.upsert({
    where: { key: VAULT_PIN_KEY },
    update: { value: hash },
    create: { key: VAULT_PIN_KEY, value: hash },
  })
  await saveLockoutState({ failedAttempts: 0, lockedUntil: null })

  const expiresAt = await setUnlockCookie(user.id!)
  await logVaultAudit(user.id!, 'VAULT_PIN_SETUP', 'vault_pin')

  return ok({ expiresAt })
}

/**
 * Unlocks the CEO Vault for 10 minutes using the personal Vault PIN / Passphrase.
 */
export async function unlockVault(pin: string): Promise<ActionResult<{ expiresAt: number }>> {
  const user = await requireCeoUser()
  const trimmed = pin.trim()

  const lockout = await getLockoutState()
  if (lockout.lockedUntil && Date.now() < lockout.lockedUntil) {
    const waitSeconds = Math.ceil((lockout.lockedUntil - Date.now()) / 1000)
    return fail(`Too many failed attempts. Please wait ${waitSeconds} seconds before trying again.`)
  }

  const pinSetting = await prisma.setting.findUnique({ where: { key: VAULT_PIN_KEY } })
  if (!pinSetting?.value) {
    return fail('Vault PIN is not configured yet.')
  }

  const isValid = await bcrypt.compare(trimmed, pinSetting.value)
  if (!isValid) {
    const nextFailed = (lockout.failedAttempts || 0) + 1
    const isNowLocked = nextFailed >= MAX_FAILED_ATTEMPTS
    await saveLockoutState({
      failedAttempts: isNowLocked ? 0 : nextFailed,
      lockedUntil: isNowLocked ? Date.now() + LOCKOUT_DURATION_MS : null,
    })
    await logVaultAudit(user.id!, 'VAULT_UNLOCK_FAILED', 'vault_pin', { attempt: nextFailed })
    if (isNowLocked) {
      return fail('Too many incorrect attempts. Vault temporarily locked for 5 minutes.')
    }
    return fail(`Incorrect Vault PIN. ${MAX_FAILED_ATTEMPTS - nextFailed} attempt(s) remaining.`)
  }

  await saveLockoutState({ failedAttempts: 0, lockedUntil: null })
  const expiresAt = await setUnlockCookie(user.id!)
  await logVaultAudit(user.id!, 'VAULT_UNLOCK', 'vault_session')

  return ok({ expiresAt })
}

/**
 * Immediately locks the CEO Vault by clearing the HttpOnly cookie.
 */
export async function lockVault(): Promise<ActionResult<{ locked: boolean }>> {
  const user = await requireCeoUser()
  const cookieStore = await cookies()
  cookieStore.delete(VAULT_COOKIE_NAME)
  await logVaultAudit(user.id!, 'VAULT_LOCK', 'vault_session')
  return ok({ locked: true })
}

/**
 * Changes the CEO Vault PIN after verifying the current PIN.
 */
export async function changeVaultPin(
  currentPin: string,
  newPin: string
): Promise<ActionResult<{ expiresAt: number }>> {
  const user = await requireCeoUser()
  const trimmedNew = newPin.trim()
  if (trimmedNew.length < 6) {
    return fail('New Vault PIN must be at least 6 characters.')
  }

  const pinSetting = await prisma.setting.findUnique({ where: { key: VAULT_PIN_KEY } })
  if (!pinSetting?.value) {
    return fail('Vault PIN is not configured yet.')
  }

  const isValid = await bcrypt.compare(currentPin.trim(), pinSetting.value)
  if (!isValid) {
    return fail('Current Vault PIN is incorrect.')
  }

  const hash = await bcrypt.hash(trimmedNew, 12)
  await prisma.setting.update({
    where: { key: VAULT_PIN_KEY },
    data: { value: hash },
  })
  await saveLockoutState({ failedAttempts: 0, lockedUntil: null })

  const expiresAt = await setUnlockCookie(user.id!)
  await logVaultAudit(user.id!, 'VAULT_PIN_CHANGE', 'vault_pin')

  return ok({ expiresAt })
}

/**
 * Recoverable PIN reset using the CEO's main account login password.
 * Encrypted credentials remain completely intact because encryption uses VAULT_ENCRYPTION_KEY.
 */
export async function resetVaultPinWithAccountPassword(
  accountPassword: string,
  newPin: string
): Promise<ActionResult<{ expiresAt: number }>> {
  const sessionUser = await requireCeoUser()
  const trimmedNew = newPin.trim()
  if (trimmedNew.length < 6) {
    return fail('New Vault PIN must be at least 6 characters.')
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id! },
    select: { id: true, password: true },
  })

  if (!dbUser?.password) {
    return fail('Unable to verify account password.')
  }

  const passwordValid = await bcrypt.compare(accountPassword, dbUser.password)
  if (!passwordValid) {
    await logVaultAudit(sessionUser.id!, 'VAULT_PIN_RESET_FAILED', 'vault_pin')
    return fail('Incorrect account login password.')
  }

  const hash = await bcrypt.hash(trimmedNew, 12)
  await prisma.setting.upsert({
    where: { key: VAULT_PIN_KEY },
    update: { value: hash },
    create: { key: VAULT_PIN_KEY, value: hash },
  })
  await saveLockoutState({ failedAttempts: 0, lockedUntil: null })

  const expiresAt = await setUnlockCookie(sessionUser.id!)
  await logVaultAudit(sessionUser.id!, 'VAULT_PIN_RESET', 'vault_pin')

  return ok({ expiresAt })
}

/**
 * Lists non-secret metadata for all CEO vault credentials.
 */
export async function listVaultItems(): Promise<ActionResult<VaultItemSummary[]>> {
  await requireCeoUser()
  const items = await prisma.ceoVaultItem.findMany({
    select: {
      id: true,
      title: true,
      category: true,
      folder: true,
      provider: true,
      loginUrl: true,
      username: true,
      host: true,
      port: true,
      tags: true,
      isFavorite: true,
      hasTotp: true,
      hasSshKey: true,
      lastRotatedAt: true,
      lastAccessedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ isFavorite: 'desc' }, { updatedAt: 'desc' }],
  })

  return ok(items.map(serializeSummary))
}

/**
 * Decrypts and returns the full secrets of a single credential item.
 * Requires both CEO auth and an active signed HttpOnly unlock cookie.
 */
export async function revealVaultItem(id: string): Promise<ActionResult<VaultItemRevealed>> {
  const user = await requireCeoUser()
  const unlock = await verifyVaultUnlocked(user.id!)
  if (!unlock.unlocked) {
    return fail('VAULT_LOCKED')
  }

  const item = await prisma.ceoVaultItem.findUnique({ where: { id } })
  if (!item) {
    return fail('Credential not found.')
  }

  try {
    const secrets = decryptVaultPayload(item.encryptedPayload)
    const currentTotp = secrets.totpSecret ? generateTotpCode(secrets.totpSecret) : null

    const updated = await prisma.ceoVaultItem.update({
      where: { id },
      data: { lastAccessedAt: new Date() },
    })

    // Slide the unlock session forward on active use
    await setUnlockCookie(user.id!)
    await logVaultAudit(user.id!, 'VAULT_REVEAL', item.id, {
      title: item.title,
      category: item.category,
    })

    return ok({
      ...serializeSummary(updated),
      secrets,
      currentTotp,
    })
  } catch (err: any) {
    return fail(err?.message || 'Failed to decrypt credential payload.')
  }
}

/**
 * Refreshes the live 6-digit TOTP code for an unlocked credential item.
 */
export async function refreshVaultItemTotp(
  id: string
): Promise<ActionResult<{ code: string; remainingSeconds: number; period: number } | null>> {
  const user = await requireCeoUser()
  const unlock = await verifyVaultUnlocked(user.id!)
  if (!unlock.unlocked) {
    return fail('VAULT_LOCKED')
  }

  const item = await prisma.ceoVaultItem.findUnique({
    where: { id },
    select: { encryptedPayload: true },
  })
  if (!item) return fail('Credential not found.')

  try {
    const secrets = decryptVaultPayload(item.encryptedPayload)
    if (!secrets.totpSecret) return ok(null)
    return ok(generateTotpCode(secrets.totpSecret))
  } catch {
    return fail('Failed to generate 2FA code.')
  }
}

/**
 * Creates or updates an encrypted credential in PostgreSQL.
 */
export async function saveVaultItem(
  input: VaultItemInput
): Promise<ActionResult<{ item: VaultItemSummary; expiresAt: number }>> {
  const user = await requireCeoUser()
  const unlock = await verifyVaultUnlocked(user.id!)
  if (!unlock.unlocked) {
    return fail('VAULT_LOCKED')
  }

  const title = input.title?.trim()
  if (!title) {
    return fail('Title is required.')
  }

  const cleanedSecrets: VaultSecretPayload = {
    password: input.secrets.password?.trim() || undefined,
    sshPrivateKey: input.secrets.sshPrivateKey?.trim() || undefined,
    sshPassphrase: input.secrets.sshPassphrase?.trim() || undefined,
    apiKey: input.secrets.apiKey?.trim() || undefined,
    envBlock: input.secrets.envBlock?.trim() || undefined,
    totpSecret: input.secrets.totpSecret?.trim() || undefined,
    recoveryEmail: input.secrets.recoveryEmail?.trim() || undefined,
    recoveryPhone: input.secrets.recoveryPhone?.trim() || undefined,
    backupCodes: input.secrets.backupCodes?.trim() || undefined,
    notes: input.secrets.notes?.trim() || undefined,
  }

  const encryptedPayload = encryptVaultPayload(cleanedSecrets)
  const hasTotp = Boolean(cleanedSecrets.totpSecret)
  const hasSshKey = Boolean(cleanedSecrets.sshPrivateKey)
  const tags = Array.from(
    new Set(
      (input.tags || [])
        .map((t) => t.trim())
        .filter(Boolean)
    )
  )

  if (input.id) {
    const existing = await prisma.ceoVaultItem.findUnique({ where: { id: input.id } })
    if (!existing) {
      return fail('Credential not found.')
    }

    let passwordRotated = false
    try {
      const oldSecrets = decryptVaultPayload(existing.encryptedPayload)
      if (oldSecrets.password !== cleanedSecrets.password && cleanedSecrets.password) {
        passwordRotated = true
      }
    } catch {
      passwordRotated = true
    }

    const updated = await prisma.ceoVaultItem.update({
      where: { id: input.id },
      data: {
        title,
        category: input.category as CeoVaultCategory,
        folder: input.folder?.trim() || 'Agency Core',
        provider: input.provider?.trim() || null,
        loginUrl: input.loginUrl?.trim() || null,
        username: input.username?.trim() || null,
        host: input.host?.trim() || null,
        port: input.port?.trim() || null,
        tags,
        isFavorite: Boolean(input.isFavorite),
        hasTotp,
        hasSshKey,
        encryptedPayload,
        ...(passwordRotated ? { lastRotatedAt: new Date() } : {}),
      },
    })

    const expiresAt = await setUnlockCookie(user.id!)
    await logVaultAudit(user.id!, 'VAULT_UPDATE', updated.id, {
      title: updated.title,
      category: updated.category,
      passwordRotated,
    })

    return ok({ item: serializeSummary(updated), expiresAt })
  }

  const created = await prisma.ceoVaultItem.create({
    data: {
      title,
      category: input.category as CeoVaultCategory,
      folder: input.folder?.trim() || 'Agency Core',
      provider: input.provider?.trim() || null,
      loginUrl: input.loginUrl?.trim() || null,
      username: input.username?.trim() || null,
      host: input.host?.trim() || null,
      port: input.port?.trim() || null,
      tags,
      isFavorite: Boolean(input.isFavorite),
      hasTotp,
      hasSshKey,
      encryptedPayload,
      lastRotatedAt: new Date(),
    },
  })

  const expiresAt = await setUnlockCookie(user.id!)
  await logVaultAudit(user.id!, 'VAULT_CREATE', created.id, {
    title: created.title,
    category: created.category,
  })

  return ok({ item: serializeSummary(created), expiresAt })
}

/**
 * Toggles favorite status on a credential item.
 */
export async function toggleVaultFavorite(id: string): Promise<ActionResult<VaultItemSummary>> {
  await requireCeoUser()
  const existing = await prisma.ceoVaultItem.findUnique({ where: { id } })
  if (!existing) return fail('Credential not found.')

  const updated = await prisma.ceoVaultItem.update({
    where: { id },
    data: { isFavorite: !existing.isFavorite },
  })
  return ok(serializeSummary(updated))
}

/**
 * Permanently deletes a credential from the CEO Vault.
 */
export async function deleteVaultItem(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const user = await requireCeoUser()
  const unlock = await verifyVaultUnlocked(user.id!)
  if (!unlock.unlocked) {
    return fail('VAULT_LOCKED')
  }

  const existing = await prisma.ceoVaultItem.findUnique({ where: { id } })
  if (!existing) return fail('Credential not found.')

  await prisma.ceoVaultItem.delete({ where: { id } })
  await logVaultAudit(user.id!, 'VAULT_DELETE', id, {
    title: existing.title,
    category: existing.category,
  })

  await notifyExecutives({
    actorId: user.id,
    actorName: user.name,
    category: 'SECURITY',
    priority: 'HIGH',
    eventKey: 'vault.item_deleted',
    title: `CEO Vault Item Deleted`,
    body: `${user.name || 'Executive'} deleted "${existing.title}" (${existing.category}) from CEO Vault.`,
    url: '/vault',
    metadata: { deletedId: id },
  })

  return ok({ deletedId: id })
}

/**
 * Exports all CEO credentials as a passphrase-encrypted portable JSON backup.
 */
export async function exportEncryptedVaultBackup(
  backupPassphrase: string
): Promise<ActionResult<{ filename: string; content: string; count: number }>> {
  const user = await requireCeoUser()
  const unlock = await verifyVaultUnlocked(user.id!)
  if (!unlock.unlocked) {
    return fail('VAULT_LOCKED')
  }

  if (!backupPassphrase || backupPassphrase.trim().length < 8) {
    return fail('Backup encryption passphrase must be at least 8 characters.')
  }

  const items = await prisma.ceoVaultItem.findMany({ orderBy: { createdAt: 'asc' } })
  const decryptedItems = items.map((item) => ({
    title: item.title,
    category: item.category,
    folder: item.folder,
    provider: item.provider,
    loginUrl: item.loginUrl,
    username: item.username,
    host: item.host,
    port: item.port,
    tags: item.tags,
    isFavorite: item.isFavorite,
    secrets: decryptVaultPayload(item.encryptedPayload),
  }))

  const content = encryptBackupWithPassphrase(decryptedItems, backupPassphrase.trim())
  const dateStr = new Date().toISOString().split('T')[0]

  await logVaultAudit(user.id!, 'VAULT_EXPORT', 'vault_backup', { count: decryptedItems.length })

  await notifyExecutives({
    actorId: user.id,
    actorName: user.name,
    category: 'SECURITY',
    priority: 'URGENT',
    eventKey: 'vault.backup_exported',
    title: `CEO Vault Backup Exported`,
    body: `${user.name || 'Executive'} exported an encrypted backup of ${decryptedItems.length} vault credentials.`,
    url: '/vault',
    metadata: { count: decryptedItems.length },
  })

  return ok({
    filename: `artyx-ceo-vault-backup-${dateStr}.enc.json`,
    content,
    count: decryptedItems.length,
  })
}

/**
 * Restores credentials from a passphrase-encrypted portable JSON backup.
 */
export async function importEncryptedVaultBackup(
  rawJson: string,
  backupPassphrase: string
): Promise<ActionResult<{ importedCount: number }>> {
  const user = await requireCeoUser()
  const unlock = await verifyVaultUnlocked(user.id!)
  if (!unlock.unlocked) {
    return fail('VAULT_LOCKED')
  }

  try {
    const items = decryptBackupWithPassphrase<VaultItemInput[]>(rawJson, backupPassphrase.trim())
    if (!Array.isArray(items)) {
      return fail('Backup payload does not contain a valid list of credentials.')
    }

    let importedCount = 0
    for (const entry of items) {
      if (!entry?.title) continue
      const secrets: VaultSecretPayload = entry.secrets || {}
      await prisma.ceoVaultItem.create({
        data: {
          title: String(entry.title).trim(),
          category: (entry.category as CeoVaultCategory) || 'OTHER',
          folder: entry.folder || 'Agency Core',
          provider: entry.provider || null,
          loginUrl: entry.loginUrl || null,
          username: entry.username || null,
          host: entry.host || null,
          port: entry.port || null,
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          isFavorite: Boolean(entry.isFavorite),
          hasTotp: Boolean(secrets.totpSecret),
          hasSshKey: Boolean(secrets.sshPrivateKey),
          encryptedPayload: encryptVaultPayload(secrets),
        },
      })
      importedCount++
    }

    await logVaultAudit(user.id!, 'VAULT_IMPORT', 'vault_backup', { importedCount })
    return ok({ importedCount })
  } catch {
    return fail('Failed to decrypt backup. Check that the file and passphrase are correct.')
  }
}

/**
 * Fetches recent audit log activity for the CEO Credential Vault.
 */
export async function getVaultAuditLogs(limit = 30): Promise<ActionResult<VaultAuditEntry[]>> {
  await requireCeoUser()
  const logs = await prisma.auditLog.findMany({
    where: { entity: 'CEO_VAULT' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      entityId: true,
      metadata: true,
      createdAt: true,
    },
  })

  return ok(
    logs.map((l) => ({
      id: l.id,
      action: l.action,
      entityId: l.entityId,
      metadata: (l.metadata as Record<string, unknown> | null) ?? null,
      createdAt: l.createdAt.toISOString(),
    }))
  )
}
