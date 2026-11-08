"use server";

import { requireAuth, requireRole } from "@/lib/actions/auth-guard";
import { fail, ok } from "@/lib/actions/result";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { logAudit } from "@/lib/audit/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.nativeEnum(UserRole),
  outletId: z.string().cuid(),
});

const updateUserSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(2).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.coerce.boolean().optional(),
});

const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(6, "New password must be at least 6 characters")
    .optional(),
  image: z.string().optional(),
});

export async function createUser(formData: FormData) {
  const me = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);

  const parsed = createUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  if (me.role !== UserRole.SUPER_ADMIN) {
    if (parsed.data.role === UserRole.SUPER_ADMIN) {
      return fail("Only Super Admins can assign the Super Admin role");
    }
    if (parsed.data.outletId !== me.outletId) {
      return fail("You can only create users within your assigned outlet");
    }
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) return fail("Email already in use");

  const hashed = await bcrypt.hash(parsed.data.password, 12);

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      password: hashed,
      role: parsed.data.role,
      outletId: parsed.data.outletId,
    },
  });

  await logAudit("USER_CREATE", "User", user.id, {
    name: user.name,
    email: user.email,
    role: user.role,
    outletId: user.outletId,
  });

  revalidatePath("/users");
  return ok({ id: user.id, name: user.name });
}

export async function updateUser(formData: FormData) {
  const me = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);

  const parsed = updateUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { id, ...data } = parsed.data;

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { id: true, outletId: true, role: true },
  });
  if (!targetUser) return fail("User not found");

  if (me.role !== UserRole.SUPER_ADMIN) {
    if (targetUser.outletId !== me.outletId) {
      return fail("You can only update users within your assigned outlet");
    }
    if (data.role === UserRole.SUPER_ADMIN || targetUser.role === UserRole.SUPER_ADMIN) {
      return fail("You cannot modify Super Admin permissions");
    }
  }

  const user = await prisma.user.update({ where: { id }, data });

  await logAudit("USER_UPDATE", "User", user.id, {
    changedFields: Object.keys(data),
    targetRole: data.role,
    isActive: data.isActive,
  });

  revalidatePath("/users");
  return ok({ id: user.id });
}

export async function toggleUserActive(id: string) {
  const me = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, outletId: true, role: true, isActive: true },
  });
  if (!user) return fail("User not found");

  if (me.role !== UserRole.SUPER_ADMIN) {
    if (user.outletId !== me.outletId) {
      return fail("You can only modify users within your assigned outlet");
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      return fail("You cannot deactivate a Super Admin");
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive: !user.isActive },
  });

  await logAudit("USER_TOGGLE_ACTIVE", "User", updated.id, {
    isActive: updated.isActive,
    targetRole: user.role,
  });

  revalidatePath("/users");
  return ok({ id: updated.id, isActive: updated.isActive });
}

export async function deleteUser(id: string) {
  const me = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);
  if (me.id === id) return fail("You cannot delete your own account");

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { id: true, outletId: true, role: true },
  });
  if (!targetUser) return fail("User not found");

  if (me.role !== UserRole.SUPER_ADMIN) {
    if (targetUser.outletId !== me.outletId) {
      return fail("You can only delete users within your assigned outlet");
    }
    if (targetUser.role === UserRole.SUPER_ADMIN) {
      return fail("You cannot delete a Super Admin");
    }
  }

  await prisma.user.delete({ where: { id } });

  await logAudit("USER_DELETE", "User", id, {
    targetUserRole: targetUser.role,
    targetUserOutletId: targetUser.outletId,
  });

  revalidatePath("/users");
  return ok({});
}

export async function getUsers() {
  const me = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);
  const outletFilter =
    me.role === UserRole.SUPER_ADMIN ? {} : { outletId: me.outletId };

  return prisma.user.findMany({
    where: outletFilter,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLogin: true,
      createdAt: true,
      outlet: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOutlets() {
  await requireAuth();
  return prisma.outlet.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getMyProfile() {
  const me = await requireAuth();
  return prisma.user.findUnique({
    where: { id: me.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLogin: true,
      createdAt: true,
      image: true,
      outlet: { select: { name: true, code: true } },
    },
  });
}

export async function updateMyProfile(formData: FormData) {
  const me = await requireAuth();

  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = updateProfileSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  // If changing password, verify current password first
  if (parsed.data.newPassword) {
    if (!parsed.data.currentPassword)
      return fail("Current password is required to set a new password");

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { password: true },
    });
    if (!user) return fail("User not found");

    const match = await bcrypt.compare(
      parsed.data.currentPassword,
      user.password,
    );
    if (!match) return fail("Current password is incorrect");
  }

  const updateData: { name: string; password?: string; image?: string | null } = {
    name: parsed.data.name,
    image: parsed.data.image || null,
  };
  if (parsed.data.newPassword) {
    updateData.password = await bcrypt.hash(parsed.data.newPassword, 12);
  }

  await prisma.user.update({ where: { id: me.id }, data: updateData });
  revalidatePath("/profile");
  return ok({});
}

const setPinSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPin: z.string().regex(/^\d{4,8}$/, "PIN must be between 4 and 8 digits"),
});

export async function setMyPin(data: { currentPassword: string; newPin: string } | FormData) {
  const me = await requireAuth();

  const raw = data instanceof FormData ? Object.fromEntries(data) : data;
  const parsed = setPinSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, password: true },
  });
  if (!user) return fail("User not found");

  const match = await bcrypt.compare(parsed.data.currentPassword, user.password);
  if (!match) return fail("Current password is incorrect");

  const hashedPin = await bcrypt.hash(parsed.data.newPin, 12);
  await prisma.user.update({
    where: { id: me.id },
    data: { pin: hashedPin },
  });

  await logAudit("USER_PIN_UPDATED", "User", me.id, { userId: me.id });
  revalidatePath("/profile");
  return ok({ message: "Manager PIN updated successfully" });
}

export async function resetUserPin(userId: string) {
  const me = await requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, outletId: true, role: true },
  });
  if (!target) return fail("User not found");

  if (me.role !== UserRole.SUPER_ADMIN && target.outletId !== me.outletId) {
    return fail("You can only manage users in your assigned outlet");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { pin: null },
  });

  await logAudit("USER_PIN_RESET", "User", userId, {
    targetUserId: userId,
    targetUserName: target.name,
    resetByUserId: me.id,
  });

  revalidatePath("/users");
  return ok({ message: `PIN for ${target.name} has been reset.` });
}

