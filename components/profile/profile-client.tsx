"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { setMyPin, updateMyProfile } from "@/lib/actions/users";
import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import {
  Building2,
  Calendar,
  Camera,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { PushNotificationSettings } from "@/components/profile/push-notification-settings";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  TECHNICIAN: "Technician",
  ACCOUNTANT: "Accountant",
  HR: "HR",
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  ADMIN: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  MANAGER:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  CASHIER:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  TECHNICIAN:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  ACCOUNTANT:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  HR: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
};

type Profile = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLogin: Date | null;
  createdAt: Date;
  image: string | null;
  outlet: { name: string; code: string };
};

const profileSchema = z
  .object({
    name: z.string().min(2, "At least 2 characters"),
    currentPassword: z.string().optional(),
    newPassword: z.string().optional(),
    confirmPassword: z.string().optional(),
    image: z.string().optional(),
  })
  .refine(
    (d) => {
      if (d.newPassword && d.newPassword.length > 0 && d.newPassword.length < 6)
        return false;
      return true;
    },
    {
      message: "New password must be at least 6 characters",
      path: ["newPassword"],
    },
  )
  .refine((d) => !d.newPassword || d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof profileSchema>;

export function ProfileClient({ profile }: { profile: Profile }) {
  const [imagePreview, setImagePreview] = React.useState<string | null>(
    profile.image ?? null
  );
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: (zodResolver as any)(profileSchema),
    defaultValues: {
      name: profile.name,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      image: profile.image ?? "",
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be smaller than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas to crop to square max 200x200 for user profile pic
        const canvas = document.createElement("canvas");
        const size = 200;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          setImagePreview(dataUrl);
          form.setValue("image", dataUrl, { shouldDirty: true });
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImagePreview(null);
    form.setValue("image", "", { shouldDirty: true });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  async function onSubmit(values: FormValues) {
    const fd = new FormData();
    fd.append("name", values.name);
    if (values.currentPassword)
      fd.append("currentPassword", values.currentPassword);
    if (values.newPassword) fd.append("newPassword", values.newPassword);
    if (values.image !== undefined)
      fd.append("image", values.image);

    const result = await updateMyProfile(fd);
    if (result.success) {
      toast.success("Profile updated successfully");
      form.reset({
        name: values.name,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        image: values.image ?? "",
      });
      // Force page cache reload to show updated picture in dashboard and sidebar
      window.location.reload();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-6">
      {/* Info card */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Circular Photo Avatar */}
          <div className="flex flex-col items-center shrink-0 gap-2">
            <div className="relative group size-20 rounded-full border-2 border-primary/20 hover:border-primary/50 overflow-hidden bg-muted transition shadow-sm flex items-center justify-center">
              {imagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imagePreview}
                  alt={profile.name}
                  className="size-full object-cover"
                />
              ) : (
                <span className="text-3xl font-bold text-primary select-none">
                  {profile.name.charAt(0).toUpperCase()}
                </span>
              )}
              <button
                type="button"
                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white text-[10px] font-medium transition cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="size-4 mb-0.5" />
                Change
              </button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleImageChange}
            />
            {imagePreview && (
              <button
                type="button"
                className="text-[11px] text-destructive hover:underline font-medium flex items-center gap-0.5"
                onClick={handleRemoveImage}
              >
                <Trash2 className="size-3" /> Remove
              </button>
            )}
          </div>

          <div className="flex-1 text-center sm:text-left space-y-3">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <h2 className="text-lg font-semibold">{profile.name}</h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[profile.role] ?? "bg-gray-100 text-gray-700"}`}
              >
                {ROLE_LABELS[profile.role] ?? profile.role}
              </span>
              {profile.isActive ? (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  Inactive
                </span>
              )}
            </div>
            <div className="grid gap-y-1.5 gap-x-6 text-sm text-muted-foreground sm:grid-cols-2">
              <span className="flex items-center gap-2">
                <Mail className="size-3.5 shrink-0" />
                {profile.email}
              </span>
              <span className="flex items-center gap-2">
                <Building2 className="size-3.5 shrink-0" />
                {profile.outlet.name} ({profile.outlet.code})
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 shrink-0" />
                {ROLE_LABELS[profile.role] ?? profile.role}
              </span>
              <span className="flex items-center gap-2">
                <Calendar className="size-3.5 shrink-0" />
                Joined{" "}
                {new Date(profile.createdAt).toLocaleDateString([], {
                  dateStyle: "medium",
                })}
              </span>
              {profile.lastLogin && (
                <span className="flex items-center gap-2">
                  <User className="size-3.5 shrink-0" />
                  Last login:{" "}
                  {new Date(profile.lastLogin).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h3 className="font-semibold mb-4">Edit Profile</h3>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input {...field} className="max-w-sm" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <p className="text-sm font-medium text-muted-foreground">
              Change Password — leave blank to keep current password
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </div>

      {/* Manager Approval PIN Settings */}
      {(profile.role === 'SUPER_ADMIN' ||
        profile.role === 'ADMIN' ||
        profile.role === 'MANAGER') && <ManagerPinSettings />}

      {/* Web Push Notification Settings */}
      <PushNotificationSettings />
    </div>
  );
}

function ManagerPinSettings() {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPin, setNewPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      toast.error('Current password is required');
      return;
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      toast.error('PIN must be 4 to 8 digits');
      return;
    }
    if (newPin !== confirmPin) {
      toast.error('PINs do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await setMyPin({ currentPassword, newPin });
      if (res.success) {
        toast.success(res.data.message || 'PIN updated successfully');
        setCurrentPassword('');
        setNewPin('');
        setConfirmPin('');
      } else {
        toast.error(res.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div id="manager-pin" className="rounded-2xl border border-border bg-card p-6 shadow-sm scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="size-5 text-primary" />
        <h2 className="text-base font-semibold text-foreground">
          Manager Approval PIN
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Set a secure 4–8 digit PIN used to authorize high-value returns, discount overrides, and exceptions.
      </p>
      <form onSubmit={handleSetPin} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Current Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">New PIN (4–8 digits)</label>
            <Input
              type="password"
              maxLength={8}
              placeholder="••••"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Confirm PIN</label>
            <Input
              type="password"
              maxLength={8}
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save PIN
          </Button>
        </div>
      </form>
    </div>
  );
}


