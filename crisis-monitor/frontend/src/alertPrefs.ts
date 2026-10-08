import { useSyncExternalStore } from "react";

/** "Peace of mind" switch: while on, live alerts open no pop-ups and make no sound. Remembered in this browser. */
const KEY = "lens.alertsPaused";
const listeners = new Set<() => void>();
function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
let paused = read();
export const alertsPaused = () => paused;
export function setAlertsPaused(v: boolean) {
  paused = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export function useAlertsPaused(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => paused
  );
}
