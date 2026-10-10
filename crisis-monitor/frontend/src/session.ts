import { useSyncExternalStore } from "react";
import type { AuthUser } from "./api";

/** The signed-in user, readable from any component without threading a prop
 *  through the tree. App.tsx owns it and mirrors it here. */
let current: AuthUser | null = null;
const listeners = new Set<() => void>();

export function setSessionUser(user: AuthUser | null) {
  current = user;
  listeners.forEach((l) => l());
}

export function getSessionUser(): AuthUser | null {
  return current;
}

export function useSessionUser(): AuthUser | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
}

/** What this login may do. Mirrors the server's rules, which are the real
 *  enforcement — this only keeps buttons that would be refused out of sight. */
export function useCapabilities() {
  const user = useSessionUser();
  const viewer = !!user?.read_only;
  return {
    viewer,
    canEdit: !viewer,
    canExport: !viewer,
    canSharePublicly: !!user?.can_share_publicly,
  };
}
