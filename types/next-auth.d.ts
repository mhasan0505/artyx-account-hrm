import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      outletId: string;
      outletName: string;
      outletCode: string;
      image?: string | null;
    } & DefaultSession["user"];
  }
}
