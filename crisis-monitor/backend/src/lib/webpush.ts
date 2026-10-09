import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { first, run } from "../db";
import type { Env } from "../bindings";
import type { Notification, SendResult } from "./notify";

/**
 * Web Push: a notification that reaches the person's phone or computer even when The Lens is not open and the device
 * is asleep, delivered through the browser's own push service (Google, Apple or Mozilla).
 *
 * The server needs one signing key pair (VAPID). It is made the first time it is needed and kept in the database, so
 * there is nothing to set up. Each device that turns alerts on gives the server its own address and keys.
 */

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

let cached: { publicKey: string; privateKey: string } | null = null;

export async function getVapid(env: Env): Promise<{ publicKey: string; privateKey: string }> {
  if (cached) return cached;
  await run(env.DB, "CREATE TABLE IF NOT EXISTS push_vapid (id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at TEXT NOT NULL)");
  let row = await first<{ public_key: string; private_key: string }>(env.DB, "SELECT public_key, private_key FROM push_vapid WHERE id = 1");
  if (!row) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const raw = new Uint8Array(65);
    raw[0] = 4;
    raw.set(unb64url(jwk.x!), 1);
    raw.set(unb64url(jwk.y!), 33);
    // OR IGNORE: if two requests race, the first key wins and both read it back below.
    await run(env.DB, "INSERT OR IGNORE INTO push_vapid (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)", [b64url(raw), jwk.d!, new Date().toISOString()]);
    row = await first<{ public_key: string; private_key: string }>(env.DB, "SELECT public_key, private_key FROM push_vapid WHERE id = 1");
  }
  cached = { publicKey: row!.public_key, privateKey: row!.private_key };
  return cached;
}

/** The text of a notification as it appears on a lock screen: a headline, a few lines, and where to go on tap. */
export function pushMessage(n: Notification): { title: string; body: string; url: string; tag: string } {
  const first = n.sections[0];
  const body = [first ? first.heading : "", first ? first.changed : n.overview, n.sections.length > 1 ? `+ ${n.sections.length - 1} more` : ""].filter(Boolean).join("\n");
  return { title: n.subject.replace(/^\[Test\]\s*/, "Test · ").slice(0, 120), body: body.slice(0, 400), url: "/", tag: "escalation-alert" };
}

/** Checks a device's subscription (as the browser gives it) and returns it in the form stored, or null if it is not usable. */
export function cleanPushDestination(raw: string): string | null {
  try {
    const s = JSON.parse(raw) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://") || s.endpoint.length > 1000) return null;
    if (typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
    return JSON.stringify({ endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
  } catch {
    return null;
  }
}

export async function sendPush(env: Env, destination: string, n: Notification): Promise<SendResult> {
  let subscription: PushSubscription;
  try {
    subscription = JSON.parse(destination) as PushSubscription;
  } catch {
    return { ok: false, error: "This device's address is not valid; turn alerts on again from it.", gone: true };
  }
  try {
    const vapid = await getVapid(env);
    const subject = env.ALERT_EMAIL_FROM && /@/.test(env.ALERT_EMAIL_FROM) ? `mailto:${env.ALERT_EMAIL_FROM.replace(/^.*<|>.*$/g, "")}` : "mailto:alerts@afrilensconsulting.com";
    const payload = await buildPushPayload({ data: pushMessage(n), options: { ttl: 6 * 3600, urgency: "high" } }, subscription, { subject, ...vapid });
    const res = await fetch(subscription.endpoint, payload);
    if (res.ok) return { ok: true };
    if (res.status === 404 || res.status === 410) return { ok: false, error: "This device has stopped accepting alerts (it was removed or permission was withdrawn).", gone: true };
    const detail = (await res.text().catch(() => "")).slice(0, 160);
    return { ok: false, error: `Push service answered ${res.status}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    return { ok: false, error: `Push send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
