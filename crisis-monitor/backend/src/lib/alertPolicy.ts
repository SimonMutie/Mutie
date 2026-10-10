import type { Env } from "../bindings";
import { first } from "../db";

/**
 * Where a client's alerts may be sent. Alert emails and messages carry
 * analysis the client is licensed to read, so a client login can only have
 * them delivered to its own organisation's email domains and to Signal
 * numbers the admin has approved. The platform admin is not restricted, and
 * a device's own browser notifications are always fine.
 */
export function splitList(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export async function destinationRefusal(env: Env, userId: string, role: string, channel: "email" | "signal" | "push", destination: string): Promise<string | null> {
  if (role === "admin" || channel === "push") return null;
  let row: { alert_email_domains: string | null; alert_signal_numbers: string | null } | null = null;
  try {
    row = await first(env.DB, `SELECT c.alert_email_domains AS alert_email_domains, c.alert_signal_numbers AS alert_signal_numbers FROM users u LEFT JOIN clients c ON u.client_id = c.id WHERE u.id = ?`, [userId]);
  } catch {
    row = null;
  }
  if (channel === "email") {
    const domains = splitList(row?.alert_email_domains);
    const domain = destination.split("@").pop()?.toLowerCase() ?? "";
    if (domains.length === 0) return "Email alerts aren't set up for your organisation yet. Ask your Afrilens contact to add your email domain.";
    if (!domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return `Alerts can only go to your organisation's email (${domains.map((d) => "@" + d).join(", ")}).`;
    return null;
  }
  const numbers = splitList(row?.alert_signal_numbers).map((n) => n.replace(/[^\d+]/g, ""));
  if (numbers.length === 0) return "Signal alerts aren't set up for your organisation yet. Ask your Afrilens contact to approve a number.";
  if (!numbers.includes(destination.replace(/[^\d+]/g, "").toLowerCase())) return "That Signal number hasn't been approved for your organisation. Ask your Afrilens contact.";
  return null;
}
