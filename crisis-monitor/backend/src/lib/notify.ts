import { cleanPushDestination, sendPush } from "./webpush";
import type { Env } from "../bindings";

/**
 * Outbound alert delivery: the message shape every alert is written in, how
 * it reads as plain text (Signal, and the text half of an email) and as
 * HTML (the email), and the two senders.
 *
 *   • Email — through Resend's HTTP API (RESEND_API_KEY + ALERT_EMAIL_FROM).
 *     A Worker cannot open SMTP connections, so an HTTP mail API is the way.
 *   • Signal — through a signal-cli-rest-api server the operator runs
 *     (SIGNAL_API_URL + SIGNAL_SENDER_NUMBER). Signal has no hosted bot API;
 *     this is the supported route for sending as a registered number.
 *
 * Neither is configured out of the box. A channel with no credentials is
 * reported as unavailable (channelsAvailable) so the interface can say so,
 * and a send to it fails with a clear message rather than silently.
 */

export type Channel = "email" | "signal" | "push";

export interface NotificationLink {
  title: string;
  url: string;
  /** Outlet or domain, shown after the title. */
  source?: string | null;
}

export interface NotificationSection {
  /** Small heading, e.g. "CRITICAL · Mekelle, Tigray". */
  heading: string;
  /** One-line statement of what is new or changed in this section. */
  changed: string;
  /** The interpretive reading: why it matters, what it suggests. */
  analysis: string;
  links: NotificationLink[];
  /** The escalation incident this section is about, so a map can be attached to it. */
  incidentId?: string;
  /** A static map of where it happened, sent as an inline image in emails. */
  map?: { cid: string; base64: string; caption: string };
}

export interface Notification {
  subject: string;
  /** What changed overall, in a sentence or two. */
  overview: string;
  /** Overall analytical framing; optional where each section carries its own. */
  analysis?: string;
  sections: NotificationSection[];
  /** Links not tied to a section (a query digest's cited items). */
  links: NotificationLink[];
  /** Where to open the thing in the platform, when known. */
  footer?: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  /** The destination no longer exists (a device that removed the app or withdrew permission): drop it. */
  gone?: boolean;
}

export function channelsAvailable(env: Env): Record<Channel, boolean> {
  return {
    push: true,
    email: !!(env.RESEND_API_KEY && env.ALERT_EMAIL_FROM),
    signal: !!(env.SIGNAL_API_URL && env.SIGNAL_SENDER_NUMBER),
  };
}

// ── Destination checks ───────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;

/** Returns the cleaned destination, or null when it is not valid for the channel. */
export function cleanDestination(channel: Channel, raw: string): string | null {
  const v = raw.trim();
  if (channel === "push") return cleanPushDestination(v);
  if (channel === "email") return EMAIL_RE.test(v) && v.length <= 254 ? v.toLowerCase() : null;
  const phone = v.replace(/[\s\-()]/g, "");
  return PHONE_RE.test(phone) ? phone : null;
}

// ── Rendering ────────────────────────────────────────────────────────────

const MAX_TEXT = 3800;

function linkLine(l: NotificationLink): string {
  return `• ${l.title.trim() || l.url}${l.source ? ` (${l.source})` : ""}\n  ${l.url}`;
}

export function toText(n: Notification): string {
  const out: string[] = [n.subject, "", n.overview];
  if (n.analysis) out.push("", "ANALYSIS", n.analysis);
  for (const s of n.sections) {
    out.push("", "───", s.heading, `What changed: ${s.changed}`);
    if (s.analysis) out.push(`Analysis: ${s.analysis}`);
    if (s.links.length) out.push("Sources:", ...s.links.map(linkLine));
  }
  if (n.links.length) out.push("", "LINKS", ...n.links.map(linkLine));
  if (n.footer) out.push("", n.footer);
  const text = out.join("\n");
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 30).trimEnd()}\n… (message shortened)`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Only http(s) links are ever made clickable. */
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : "#");

function linkHtml(l: NotificationLink): string {
  return `<li style="margin:0 0 4px"><a href="${safeUrl(l.url)}" style="color:#2b5cc4">${esc(l.title.trim() || l.url)}</a>${l.source ? ` <span style="color:#6b7385">— ${esc(l.source)}</span>` : ""}</li>`;
}

export function toHtml(n: Notification): string {
  const parts: string[] = [];
  parts.push(`<h2 style="margin:0 0 8px;font-size:18px">${esc(n.subject)}</h2>`);
  parts.push(`<p style="margin:0 0 12px;line-height:1.55;white-space:pre-line">${esc(n.overview)}</p>`);
  if (n.analysis) parts.push(`<p style="margin:0 0 12px;line-height:1.55"><strong>Analysis.</strong> ${esc(n.analysis)}</p>`);
  for (const s of n.sections) {
    parts.push(`<div style="border-top:1px solid #d8dce6;padding-top:10px;margin-top:12px">`);
    parts.push(`<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7385;font-weight:700">${esc(s.heading)}</div>`);
    if (s.map) parts.push(`<div style="margin:8px 0"><img src="cid:${esc(s.map.cid)}" width="640" alt="Map of where this happened" style="display:block;width:100%;max-width:640px;height:auto;border-radius:6px;border:1px solid #d8dce6"><div style="font-size:11px;color:#6b7385;margin-top:4px">${esc(s.map.caption)}</div></div>`);
    parts.push(`<p style="margin:6px 0;line-height:1.55"><strong>What changed.</strong> ${esc(s.changed)}</p>`);
    if (s.analysis) parts.push(`<p style="margin:6px 0;line-height:1.55"><strong>Analysis.</strong> ${esc(s.analysis)}</p>`);
    if (s.links.length) parts.push(`<ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${s.links.map(linkHtml).join("")}</ul>`);
    parts.push(`</div>`);
  }
  if (n.links.length) parts.push(`<div style="margin-top:14px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7385;font-weight:700">Links</div><ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${n.links.map(linkHtml).join("")}</ul>`);
  if (n.footer) parts.push(`<p style="margin:16px 0 0;font-size:12px;color:#6b7385">${esc(n.footer)}</p>`);
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#1b2030;max-width:640px">${parts.join("")}</div>`;
}

// ── Senders ──────────────────────────────────────────────────────────────

const SEND_TIMEOUT_MS = 15_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
}

/** A ready-made email (own HTML and text), optionally with a Reply-To. */
export async function sendRawEmail(env: Env, to: string, msg: { subject: string; html: string; text: string; replyTo?: string }): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_FROM) return { ok: false, error: "Email delivery is not set up on this platform yet (RESEND_API_KEY / ALERT_EMAIL_FROM)." };
  try {
    const res = await postJson(
      "https://api.resend.com/emails",
      { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      { from: env.ALERT_EMAIL_FROM, to: [to], subject: msg.subject.replace(/[\r\n]+/g, " ").slice(0, 200), html: msg.html, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) }
    );
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `Email provider answered ${res.status}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    return { ok: false, error: `Email send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function sendEmail(env: Env, to: string, n: Notification): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_FROM) return { ok: false, error: "Email delivery is not set up on this platform yet (RESEND_API_KEY / ALERT_EMAIL_FROM)." };
  try {
    const res = await postJson(
      "https://api.resend.com/emails",
      { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      {
        from: env.ALERT_EMAIL_FROM,
        to: [to],
        subject: n.subject.slice(0, 200),
        html: toHtml(n),
        text: toText(n),
        // Inline images the HTML points at with cid:
        ...(n.sections.some((s) => s.map)
          ? { attachments: n.sections.filter((s) => s.map).map((s) => ({ filename: `${s.map!.cid}.png`, content: s.map!.base64, content_type: "image/png", content_id: s.map!.cid })) }
          : {}),
      }
    );
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `Email provider answered ${res.status}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    return { ok: false, error: `Email send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function sendSignal(env: Env, recipient: string, n: Notification): Promise<SendResult> {
  if (!env.SIGNAL_API_URL || !env.SIGNAL_SENDER_NUMBER) return { ok: false, error: "Signal delivery is not set up on this platform yet (SIGNAL_API_URL / SIGNAL_SENDER_NUMBER)." };
  try {
    const base = env.SIGNAL_API_URL.replace(/\/+$/, "");
    const res = await postJson(
      `${base}/v2/send`,
      env.SIGNAL_API_TOKEN ? { Authorization: `Bearer ${env.SIGNAL_API_TOKEN}` } : {},
      { message: toText(n), number: env.SIGNAL_SENDER_NUMBER, recipients: [recipient] }
    );
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `Signal gateway answered ${res.status}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    return { ok: false, error: `Signal send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function sendNotification(env: Env, channel: Channel, destination: string, n: Notification): Promise<SendResult> {
  return channel === "email" ? sendEmail(env, destination, n) : channel === "push" ? sendPush(env, destination, n) : sendSignal(env, destination, n);
}
