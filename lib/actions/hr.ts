"use server";

import { requireAuth, requireRole, validateOutletAccess } from "@/lib/actions/auth-guard";
import { fail, ok } from "@/lib/actions/result";
import { prisma } from "@/lib/db";
import { logAuditDirect } from "@/lib/audit/logger";
import { AttendanceStatus, LeaveStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ─── Employee ────────────────────────────────────────────────────────────────

const employeeSchema = z.object({
  employeeCode: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  departmentId: z.string(),
  designationId: z.string(),
  outletId: z.string(),
  joinDate: z.coerce.date(),
  basicSalary: z.coerce.number().positive(),
  userId: z.string().optional(),
});

export async function createEmployee(data: z.infer<typeof employeeSchema>) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.MANAGER,
  );
  const parsed = employeeSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const targetOutletId =
    user.role === UserRole.SUPER_ADMIN && parsed.data.outletId
      ? parsed.data.outletId
      : user.outletId;

  if (!targetOutletId) return fail("No outlet assigned to user");

  const exists = await prisma.employee.findUnique({
    where: { employeeCode: parsed.data.employeeCode },
  });
  if (exists) return fail("Employee code already exists");

  const employee = await prisma.employee.create({
    data: {
      ...parsed.data,
      outletId: targetOutletId,
      email: parsed.data.email?.trim() ? parsed.data.email.trim() : undefined,
      phone: parsed.data.phone?.trim() ? parsed.data.phone.trim() : undefined,
      userId: parsed.data.userId?.trim()
        ? parsed.data.userId.trim()
        : undefined,
    },
  });
  revalidatePath("/users");
  revalidatePath("/hr/employees");
  return ok(employee);
}

const updateEmployeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  departmentId: z.string(),
  designationId: z.string(),
  basicSalary: z.coerce.number().positive(),
  isActive: z.boolean(),
});

export async function updateEmployee(
  data: z.infer<typeof updateEmployeeSchema>,
) {
  const user = await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR,
    UserRole.MANAGER,
  );

  const parsed = updateEmployeeSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const existing = await prisma.employee.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, outletId: true, userId: true, isActive: true },
  });
  if (!existing) return fail("Employee not found");

  try {
    validateOutletAccess(user, existing.outletId);
  } catch (err: any) {
    return fail(err.message || "Forbidden: Outlet access denied");
  }

  const employee = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: parsed.data.id },
      data: {
        name: parsed.data.name,
        phone: parsed.data.phone?.trim() ? parsed.data.phone.trim() : null,
        email: parsed.data.email?.trim() ? parsed.data.email.trim() : null,
        departmentId: parsed.data.departmentId,
        designationId: parsed.data.designationId,
        basicSalary: parsed.data.basicSalary,
        isActive: parsed.data.isActive,
      },
    });

    if (!parsed.data.isActive && existing.userId) {
      await tx.user.update({
        where: { id: existing.userId },
        data: { isActive: false },
      });
    }

    return updated;
  });

  if (!parsed.data.isActive && existing.userId) {
    await logAuditDirect(
      user.id,
      "USER_DEACTIVATE_VIA_EMPLOYEE",
      "User",
      existing.userId,
      { employeeId: existing.id }
    );
  }

  revalidatePath("/users");
  revalidatePath("/hr/employees");
  return ok(employee);
}

export async function getHrLookups() {
  await requireAuth();

  const [departments, designations, outlets] = await Promise.all([
    prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.designation.findMany({
      select: { id: true, name: true, departmentId: true },
      orderBy: { name: "asc" },
    }),
    prisma.outlet.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { departments, designations, outlets };
}

export async function getEmployees() {
  const user = await requireRole(
    UserRole.HR,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  );
  const outletFilter =
    user.role === UserRole.SUPER_ADMIN ? {} : { outletId: user.outletId };
  return prisma.employee.findMany({
    where: outletFilter,
    include: {
      department: { select: { name: true } },
      designation: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Public/General employee directory listing (excludes basicSalary, NID, etc.)
 */
export async function getEmployeeDirectory() {
  const user = await requireAuth();
  const outletFilter =
    user.role === UserRole.SUPER_ADMIN ? {} : { outletId: user.outletId };
  return prisma.employee.findMany({
    where: { ...outletFilter, isActive: true },
    select: {
      id: true,
      employeeCode: true,
      name: true,
      email: true,
      phone: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      outletId: true,
      isActive: true,
    },
    orderBy: { name: "asc" },
  });
}

// ─── Attendance ───────────────────────────────────────────────────────────────

const attendanceSchema = z.object({
  employeeId: z.string(),
  date: z.coerce
    .date()
    .refine(
      (d) => d.getTime() <= Date.now() + 24 * 60 * 60 * 1000,
      "Attendance date cannot be in the future"
    )
    .refine(
      (d) => d.getTime() >= Date.now() - 90 * 24 * 60 * 60 * 1000,
      "Attendance date cannot be more than 90 days in the past"
    ),
  status: z.nativeEnum(AttendanceStatus),
  checkIn: z.coerce.date().optional(),
  checkOut: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export async function markAttendance(data: z.infer<typeof attendanceSchema>) {
  const user = await requireRole(
    UserRole.HR,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN
  );
  const parsed = attendanceSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const emp = await prisma.employee.findUnique({
    where: { id: parsed.data.employeeId },
    select: { id: true, outletId: true },
  });
  if (!emp) return fail("Employee not found");

  try {
    validateOutletAccess(user, emp.outletId);
  } catch (err: any) {
    return fail(err.message || "Forbidden: Outlet access denied");
  }

  const rec = await prisma.attendance.upsert({
    where: {
      employeeId_date: {
        employeeId: parsed.data.employeeId,
        date: parsed.data.date,
      },
    },
    create: parsed.data,
    update: parsed.data,
  });

  await logAuditDirect(
    user.id,
    "MARK_ATTENDANCE",
    "Attendance",
    rec.id,
    {
      employeeId: parsed.data.employeeId,
      date: parsed.data.date,
      status: parsed.data.status,
    }
  );

  revalidatePath("/users");
  return ok(rec);
}

export async function getAttendance(
  employeeId: string,
  month: number,
  year: number,
) {
  await requireAuth();
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return prisma.attendance.findMany({
    where: { employeeId, date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
}

// ─── Leave ────────────────────────────────────────────────────────────────────

const leaveSchema = z.object({
  employeeId: z.string(),
  leaveTypeId: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  reason: z.string().optional(),
});

export async function createLeaveRequest(data: z.infer<typeof leaveSchema>) {
  const user = await requireAuth();
  const parsed = leaveSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const emp = await prisma.employee.findUnique({
    where: { id: parsed.data.employeeId },
    select: { id: true, outletId: true, userId: true },
  });
  if (!emp) return fail("Employee not found");

  const privilegedRoles: string[] = [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.HR,
    UserRole.MANAGER,
  ];
  const isPrivileged = privilegedRoles.includes(user.role);

  if (!isPrivileged && emp.userId !== user.id) {
    return fail("Forbidden: You can only request leave for yourself");
  }

  try {
    validateOutletAccess(user, emp.outletId);
  } catch (err: any) {
    return fail(err.message || "Forbidden: Outlet access denied");
  }

  if (parsed.data.endDate.getTime() < parsed.data.startDate.getTime()) {
    return fail('End date cannot be earlier than start date');
  }

  const days =
    Math.ceil(
      (parsed.data.endDate.getTime() - parsed.data.startDate.getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1;

  if (days <= 0) {
    return fail('Leave duration must be at least 1 day');
  }

  const year = parsed.data.startDate.getFullYear();
  let balance = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: parsed.data.employeeId,
        leaveTypeId: parsed.data.leaveTypeId,
        year,
      },
    },
  });

  if (!balance) {
    const leaveType = await prisma.leaveType.findUnique({
      where: { id: parsed.data.leaveTypeId },
    });
    if (!leaveType) return fail('Leave type not found');
    balance = await prisma.leaveBalance.create({
      data: {
        employeeId: parsed.data.employeeId,
        leaveTypeId: parsed.data.leaveTypeId,
        year,
        allocated: leaveType.annualAllowance,
        used: 0,
        remaining: leaveType.annualAllowance,
      },
    });
  }

  if (days > balance.remaining) {
    return fail(
      `Insufficient leave balance. Requested: ${days} days, remaining: ${balance.remaining} days`
    );
  }

  const req = await prisma.leaveRequest.create({
    data: { ...parsed.data, days, userId: user.id },
  });
  revalidatePath("/users");
  return ok(req);
}

export async function approveLeaveRequest(requestId: string) {
  const user = await requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN);
  const existing = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: { select: { outletId: true, userId: true } } },
  });
  if (!existing) return fail("Leave request not found");
  if (existing.status && existing.status !== LeaveStatus.PENDING) {
    return fail(`Leave request is already ${existing.status.toLowerCase()}`);
  }

  // HR-003: Prevent self-approval of leave requests
  if (existing.userId === user.id || existing.employee?.userId === user.id) {
    return fail("Forbidden: You cannot approve your own leave request");
  }
  if (existing.employee?.outletId) {
    try {
      validateOutletAccess(user, existing.employee.outletId);
    } catch {
      return fail("Forbidden: Outlet access denied");
    }
  }

  try {
    const runInTx = typeof prisma.$transaction === 'function'
      ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
      : (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updated = await runInTx(async tx => {
      if (existing.startDate && existing.leaveTypeId && existing.employeeId) {
        const year = new Date(existing.startDate).getFullYear();
        let balance = await tx.leaveBalance?.findUnique?.({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: existing.employeeId,
              leaveTypeId: existing.leaveTypeId,
              year,
            },
          },
        });

        if (!balance && tx.leaveType?.findUnique) {
          const leaveType = await tx.leaveType.findUnique({
            where: { id: existing.leaveTypeId },
          });
          if (leaveType && tx.leaveBalance?.create) {
            balance = await tx.leaveBalance.create({
              data: {
                employeeId: existing.employeeId,
                leaveTypeId: existing.leaveTypeId,
                year,
                allocated: leaveType.annualAllowance,
                used: 0,
                remaining: leaveType.annualAllowance,
              },
            });
          }
        }

        const days = Number(existing.days || 1);
        if (balance && balance.remaining < days) {
          throw new Error(
            `Insufficient leave balance. Remaining: ${balance.remaining} days, requested: ${days} days`
          );
        }

        if (balance && tx.leaveBalance?.update) {
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: {
              used: { increment: days },
              remaining: { decrement: days },
            },
          });
        }
      }

      return tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: LeaveStatus.APPROVED },
      });
    });

    revalidatePath("/users");
    return ok(updated);
  } catch (err: any) {
    return fail(err.message || "Failed to approve leave request");
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const departmentSchema = z.object({
  name: z.string().min(1),
});

export async function createDepartment(data: z.infer<typeof departmentSchema>) {
  await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.HR
  );
  const parsed = departmentSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const exists = await prisma.department.findUnique({
    where: { name: parsed.data.name },
  });
  if (exists) return fail("Department already exists");

  const dept = await prisma.department.create({ data: parsed.data });
  revalidatePath("/hr/employees");
  return ok(dept);
}

const designationSchema = z.object({
  name: z.string().min(1),
  departmentId: z.string().min(1),
});

export async function createDesignation(
  data: z.infer<typeof designationSchema>
) {
  await requireRole(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.HR
  );
  const parsed = designationSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const dept = await prisma.department.findUnique({
    where: { id: parsed.data.departmentId },
  });
  if (!dept) return fail("Department not found");

  const desig = await prisma.designation.create({ data: parsed.data });
  revalidatePath("/hr/employees");
  return ok(desig);
}
