"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { fail, ok } from "@/lib/actions/result";
import { FinanceData } from "@/lib/money-management/types";

/**
 * Checks if the currently authenticated user is the CEO.
 * Checks for primary CEO email ('mhasan.coder@gmail.com') or assigned 'CEO' custom role.
 */
export async function isCurrentUserCeo(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) return false;

  const email = session.user.email?.toLowerCase();
  if (email === "mhasan.coder@gmail.com") {
    return true;
  }

  try {
    const [userRolesSetting, customRolesSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: "user_custom_roles_map" } }),
      prisma.setting.findUnique({ where: { key: "system_custom_roles" } }),
    ]);

    if (userRolesSetting?.value && customRolesSetting?.value) {
      const map: Record<string, string> = JSON.parse(userRolesSetting.value);
      const roleId = map[session.user.id];
      if (roleId) {
        const roles: Array<{ id: string; name: string }> = JSON.parse(
          customRolesSetting.value
        );
        const role = roles.find((r) => r.id === roleId || r.name === roleId);
        if (
          role &&
          (role.name.toUpperCase() === "CEO" ||
            role.name.toUpperCase().includes("CEO") ||
            role.name.toUpperCase().includes("CHIEF EXECUTIVE") ||
            role.name.toUpperCase().includes("CHEIF EXECUTIVE"))
        ) {
          return true;
        }
      }
    }
  } catch (err) {
    console.error("[isCurrentUserCeo] Error checking custom role:", err);
  }

  return false;
}

/**
 * Server guard: requires the user to be the CEO.
 * If not authenticated, redirects to /login.
 * If not the CEO, redirects to / (Dashboard).
 */
export async function requireCeoUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const isCeo = await isCurrentUserCeo();
  if (!isCeo) {
    redirect("/");
  }

  return session.user;
}

/**
 * Load CEO financial data from database.
 */
export async function getCeoFinanceDataServer() {
  await requireCeoUser();

  const setting = await prisma.setting.findUnique({
    where: { key: "ceo_money_management_data" },
  });

  if (!setting?.value) {
    return ok<FinanceData | null>(null);
  }

  try {
    const parsed: FinanceData = JSON.parse(setting.value);
    return ok<FinanceData | null>(parsed);
  } catch {
    return ok<FinanceData | null>(null);
  }
}

/**
 * Save CEO financial data to database.
 */
export async function saveCeoFinanceDataServer(data: FinanceData) {
  await requireCeoUser();

  try {
    await prisma.setting.upsert({
      where: { key: "ceo_money_management_data" },
      update: { value: JSON.stringify(data) },
      create: { key: "ceo_money_management_data", value: JSON.stringify(data) },
    });
    return ok({ saved: true });
  } catch (err: any) {
    return fail(err?.message || "Failed to persist financial data");
  }
}
