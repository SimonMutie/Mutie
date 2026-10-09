import { api } from "./api";

/** Device notifications for escalation alerts (Web Push). Each device turns them on once; they then arrive even when
 *  The Lens is closed and the device was asleep. */

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const toKey = (b64: string) => {
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

/** The address of this device's push subscription, if it has one. */
export async function thisDeviceEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Asks permission (when not yet given), subscribes this device, and tells the server. Returns an error message, or null. */
export async function enablePushAlerts(opts: { askPermission: boolean }): Promise<string | null> {
  if (!pushSupported()) return "This browser cannot show alerts when The Lens is closed. On an iPhone or iPad, add The Lens to the Home Screen first.";
  if (Notification.permission === "denied") return "Notifications are blocked for this site. Allow them in the browser's site settings, then try again.";
  if (Notification.permission !== "granted") {
    if (!opts.askPermission) return "Permission has not been given.";
    const answer = await Notification.requestPermission();
    if (answer !== "granted") return "Notifications were not allowed on this device.";
  }
  try {
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await api.getPushKey();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
    }
    try {
      await api.createAlertSubscription({ scope: "escalations", channel: "push", destination: JSON.stringify(sub.toJSON()), min_level: "elevated", frequency_minutes: 5 });
    } catch (e) {
      // Already registered for this person: that is the state we want.
      if (!(e instanceof Error && /already get these alerts/i.test(e.message))) throw e;
    }
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    // The browser could not reach its push service (Google's, in Chrome, Edge and Brave): usually a browser setting or a blocked network.
    if (/push service|registration failed/i.test(m))
      return "This browser could not reach its notification service. In Brave, turn on Settings → Privacy and security → “Use Google services for push messaging” and restart it; in other browsers, leave private mode and make sure the network does not block Google's push service (fcm.googleapis.com). Then try again.";
    return m || "Could not turn alerts on for this device.";
  }
}
