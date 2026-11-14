import { PageHeader } from "@/components/page-header";
import { UsersClient } from "@/components/users/users-client";
import { requireRole } from "@/lib/actions/auth-guard";
import { getRoles } from "@/lib/actions/roles";
import { getOutlets, getUsers } from "@/lib/actions/users";
import { UserRole } from "@prisma/client";

export default async function UsersRolesPage() {
  const [me, users, outlets, roles] = await Promise.all([
    requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
    getUsers(),
    getOutlets(),
    getRoles(),
  ]);

  const isSuperAdmin = me.role === UserRole.SUPER_ADMIN;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Users & Roles"
        description="Manage staff logins, assign permissions, and configure custom workspace roles."
      />
      <UsersClient
        users={users}
        outlets={outlets}
        roles={roles}
        isSuperAdmin={isSuperAdmin}
        currentUserRole={me.role}
      />
    </div>
  );
}
