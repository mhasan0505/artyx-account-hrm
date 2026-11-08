import { PageHeader } from "@/components/page-header";
import { UsersClient } from "@/components/users/users-client";
import { getOutlets, getUsers } from "@/lib/actions/users";

export default async function UsersRolesPage() {
  const [users, outlets] = await Promise.all([getUsers(), getOutlets()]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Users & Roles" />
      <UsersClient users={users} outlets={outlets} />
    </div>
  );
}
