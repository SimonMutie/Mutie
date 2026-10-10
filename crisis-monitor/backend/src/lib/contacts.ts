import type { Env } from "../bindings";
import { run } from "../db";

/**
 * Contact groups: people who are not platform users (partners, journalists,
 * embassy staff, a client's wider staff) kept in named groups, so an alert or
 * publication can go to "Nairobi security managers" with one click. A contact
 * has an email and/or a phone number; the phone is used for SMS and Signal.
 */
let ready: Promise<unknown> | null = null;
export function resetContactsCheck() {
  ready = null;
}

export async function ensureContactTables(env: Env): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await run(env.DB, "CREATE TABLE IF NOT EXISTS contact_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, created_at TEXT NOT NULL)");
      await run(env.DB, "CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, name TEXT NOT NULL, organisation TEXT, email TEXT, phone TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)");
      await run(env.DB, "CREATE TABLE IF NOT EXISTS contact_group_members (group_id TEXT NOT NULL, contact_id TEXT NOT NULL, PRIMARY KEY (group_id, contact_id))");
      await run(env.DB, "CREATE INDEX IF NOT EXISTS idx_contact_members_contact ON contact_group_members (contact_id)");
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
}
