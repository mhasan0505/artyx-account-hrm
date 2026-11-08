"use server";

import { requireAuth } from "@/lib/actions/auth-guard";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export type AuditMeta = Record<string, unknown>;

/**
 * Log an audit event to the database
 * Automatically captures the current user from session
 */
export async function logAudit(
  action: string,
  entity: string,
  entityId: string,
  metadata?: AuditMeta,
) {
  try {
    const user = await requireAuth();

    const auditLog = await prisma.auditLog.create({
      data: {
        userId: user.id,
        action,
        entity,
        entityId,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    });

    return auditLog;
  } catch (error) {
    console.error("Failed to log audit event:", error);
    // Don't throw - audit logging should not break the main operation
    return null;
  }
}

/**
 * Log audit event from action without session requirement (already authenticated)
 */
export async function logAuditDirect(
  userId: string,
  action: string,
  entity: string,
  entityId: string,
  metadata?: AuditMeta,
) {
  try {
    const auditLog = await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    });

    return auditLog;
  } catch (error) {
    console.error("Failed to log audit event:", error);
    return null;
  }
}
