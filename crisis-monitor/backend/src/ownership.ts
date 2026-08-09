import { first } from "./db";
import type { Env } from "./bindings";
import type { UserRole } from "./types";

/** Admins can access every query; clients only their own ("house" queries with owner_id NULL are admin-only). */
export async function canAccessQuery(env: Env, userId: string, role: UserRole, queryId: string): Promise<boolean> {
  if (role === "admin") return true;
  const row = await first<{ owner_id: string | null }>(env.DB, "SELECT owner_id FROM monitoring_queries WHERE id = ?", [
    queryId,
  ]);
  return row?.owner_id === userId;
}

export async function canAccessAlert(env: Env, userId: string, role: UserRole, alertId: string): Promise<boolean> {
  if (role === "admin") return true;
  const row = await first<{ query_id: string | null }>(env.DB, "SELECT query_id FROM alerts WHERE id = ?", [alertId]);
  if (!row?.query_id) return false;
  return canAccessQuery(env, userId, role, row.query_id);
}
