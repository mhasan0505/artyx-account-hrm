import { ProfileClient } from "@/components/profile/profile-client";
import { getMyProfile } from "@/lib/actions/users";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <h1 className="text-xl font-semibold mb-6">My Profile</h1>
      <ProfileClient profile={profile} />
    </div>
  );
}
