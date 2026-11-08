import { create } from "zustand";

interface SessionState {
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  outletId: string | null;
  outletName: string | null;
  outletCode: string | null;

  setSession: (data: {
    userId: string;
    userName: string;
    userRole: string;
    outletId: string;
    outletName: string;
    outletCode: string;
  }) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  userName: null,
  userRole: null,
  outletId: null,
  outletName: null,
  outletCode: null,

  setSession: (data) =>
    set({
      userId: data.userId,
      userName: data.userName,
      userRole: data.userRole,
      outletId: data.outletId,
      outletName: data.outletName,
      outletCode: data.outletCode,
    }),

  clearSession: () =>
    set({
      userId: null,
      userName: null,
      userRole: null,
      outletId: null,
      outletName: null,
      outletCode: null,
    }),
}));
