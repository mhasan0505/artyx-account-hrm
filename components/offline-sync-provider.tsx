"use client";

import { useOfflineSync } from "@/hooks/use-offline-sync";

export function OfflineSyncProvider() {
  useOfflineSync();
  return null;
}
