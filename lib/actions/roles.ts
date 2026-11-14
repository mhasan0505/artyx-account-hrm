"use server";

import { requireRole } from "@/lib/actions/auth-guard";
import { fail, ok } from "@/lib/actions/result";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";
import { logAudit } from "@/lib/audit/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type RoleDefinition,
  SYSTEM_ROLES,
} from "@/types/roles";

const createRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Role title must be at least 2 characters")
    .max(50, "Role title cannot exceed 50 characters"),
  code: z
    .string()
    .trim()
    .min(2, "Role code must be at least 2 characters")
    .max(40, "Role code cannot exceed 40 characters")
    .regex(
      /^[A-Za-z0-9_]+$/,
      "Role code must only contain letters, numbers, and underscores"
    ),
  description: z.string().trim().max(300, "Description cannot exceed 300 characters").optional(),
  baseRole: z.nativeEnum(UserRole),
  permissions: z.array(z.string()).default([]),
  color: z.string().default("indigo"),
});

/**
 * Fetch all available roles (System Roles + Custom Roles) with assigned user counts.
 * Accessible to SUPER_ADMIN and ADMIN.
 */
export async function getRoles(): Promise<RoleDefinition[]> {
  await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);

  const [customRolesSetting, userRolesSetting, users] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "system_custom_roles" } }),
    prisma.setting.findUnique({ where: { key: "user_custom_roles_map" } }),
    prisma.user.findMany({
      select: { id: true, role: true, isActive: true },
    }),
  ]);

  const customRoles: RoleDefinition[] = customRolesSetting?.value
    ? JSON.parse(customRolesSetting.value)
    : [];

  const userCustomRolesMap: Record<string, string> = userRolesSetting?.value
    ? JSON.parse(userRolesSetting.value)
    : {};

  // Compute user counts
  const customRoleCounts: Record<string, number> = {};
  const systemRoleCounts: Record<UserRole, number> = {
    [UserRole.SUPER_ADMIN]: 0,
    [UserRole.ADMIN]: 0,
    [UserRole.MANAGER]: 0,
    [UserRole.ACCOUNTANT]: 0,
    [UserRole.HR]: 0,
    [UserRole.TECHNICIAN]: 0,
    [UserRole.CASHIER]: 0,
  };

  for (const user of users) {
    const customRoleId = userCustomRolesMap[user.id];
    if (customRoleId) {
      customRoleCounts[customRoleId] = (customRoleCounts[customRoleId] || 0) + 1;
    } else if (user.role && systemRoleCounts[user.role] !== undefined) {
      systemRoleCounts[user.role]++;
    }
  }

  const enrichedSystemRoles = SYSTEM_ROLES.map((r) => ({
    ...r,
    userCount: systemRoleCounts[r.baseRole] || 0,
  }));

  const enrichedCustomRoles = customRoles.map((r) => ({
    ...r,
    isSystem: false,
    userCount: customRoleCounts[r.id] || customRoleCounts[r.name] || 0,
  }));

  return [...enrichedSystemRoles, ...enrichedCustomRoles];
}

/**
 * Creates a new custom role.
 * STRICT ACCESS CONTROL: Only SUPER_ADMIN has access to create roles!
 */
export async function createRole(formData: FormData) {
  // CRITICAL ACCESS CONTROL ENFORCEMENT: ONLY SUPER_ADMIN
  const me = await requireRole(UserRole.SUPER_ADMIN);
  if (me.role !== UserRole.SUPER_ADMIN) {
    return fail("Unauthorized: Only Super Admin has access to create roles.");
  }

  const rawPermissions = formData.getAll("permissions") as string[];
  const rawData = {
    name: formData.get("name"),
    code: formData.get("code"),
    description: formData.get("description") || "",
    baseRole: formData.get("baseRole"),
    permissions: rawPermissions.length > 0 ? rawPermissions : [],
    color: formData.get("color") || "indigo",
  };

  const parsed = createRoleSchema.safeParse(rawData);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || "Validation failed");
  }

  const normalizedCode = parsed.data.code.trim().toUpperCase().replace(/\s+/g, "_");
  const normalizedName = parsed.data.name.trim();

  // Check collision with System Roles
  const systemConflict = SYSTEM_ROLES.some(
    (r) =>
      r.name === normalizedCode ||
      r.label.toLowerCase() === normalizedName.toLowerCase()
  );
  if (systemConflict) {
    return fail(`A system role with name "${normalizedName}" or code "${normalizedCode}" already exists.`);
  }

  // Check collision with existing Custom Roles
  const setting = await prisma.setting.findUnique({
    where: { key: "system_custom_roles" },
  });
  const customRoles: RoleDefinition[] = setting?.value ? JSON.parse(setting.value) : [];

  const customConflict = customRoles.some(
    (r) =>
      r.name === normalizedCode ||
      r.label.toLowerCase() === normalizedName.toLowerCase()
  );
  if (customConflict) {
    return fail(`A custom role with name "${normalizedName}" or code "${normalizedCode}" already exists.`);
  }

  const newRole: RoleDefinition = {
    id: `custom_role_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: normalizedCode,
    label: normalizedName,
    description: parsed.data.description || "",
    baseRole: parsed.data.baseRole,
    permissions: parsed.data.permissions,
    color: parsed.data.color,
    isSystem: false,
    createdBy: me.name || me.id,
    createdAt: new Date().toISOString(),
    userCount: 0,
  };

  customRoles.push(newRole);

  await prisma.setting.upsert({
    where: { key: "system_custom_roles" },
    update: { value: JSON.stringify(customRoles) },
    create: { key: "system_custom_roles", value: JSON.stringify(customRoles) },
  });

  await logAudit("ROLE_CREATE", "Role", newRole.id, {
    name: newRole.name,
    label: newRole.label,
    baseRole: newRole.baseRole,
    permissions: newRole.permissions,
    createdBy: me.name || me.id,
  });

  revalidatePath("/users");
  return ok(newRole);
}

/**
 * Deletes a custom role.
 * STRICT ACCESS CONTROL: Only SUPER_ADMIN has access to delete roles!
 */
export async function deleteRole(roleId: string) {
  // CRITICAL ACCESS CONTROL ENFORCEMENT: ONLY SUPER_ADMIN
  const me = await requireRole(UserRole.SUPER_ADMIN);
  if (me.role !== UserRole.SUPER_ADMIN) {
    return fail("Unauthorized: Only Super Admin has access to delete roles.");
  }

  // System roles can NEVER be deleted
  if (SYSTEM_ROLES.some((r) => r.id === roleId || r.name === roleId)) {
    return fail("Default system roles cannot be deleted.");
  }

  const [rolesSetting, userRolesSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "system_custom_roles" } }),
    prisma.setting.findUnique({ where: { key: "user_custom_roles_map" } }),
  ]);

  const customRoles: RoleDefinition[] = rolesSetting?.value
    ? JSON.parse(rolesSetting.value)
    : [];

  const targetRole = customRoles.find((r) => r.id === roleId || r.name === roleId);
  if (!targetRole) {
    return fail("Custom role not found.");
  }

  const userRolesMap: Record<string, string> = userRolesSetting?.value
    ? JSON.parse(userRolesSetting.value)
    : {};

  // Check if any users currently have this role
  const usersWithRole = Object.entries(userRolesMap).filter(
    ([_, rId]) => rId === targetRole.id || rId === targetRole.name
  );

  if (usersWithRole.length > 0) {
    return fail(
      `Cannot delete role "${targetRole.label}" because ${usersWithRole.length} user(s) are currently assigned to it. Please reassign those users before deleting.`
    );
  }

  const updatedRoles = customRoles.filter((r) => r.id !== targetRole.id);

  await prisma.setting.upsert({
    where: { key: "system_custom_roles" },
    update: { value: JSON.stringify(updatedRoles) },
    create: { key: "system_custom_roles", value: JSON.stringify(updatedRoles) },
  });

  await logAudit("ROLE_DELETE", "Role", targetRole.id, {
    name: targetRole.name,
    label: targetRole.label,
    deletedBy: me.name || me.id,
  });

  revalidatePath("/users");
  return ok({ id: targetRole.id });
}
