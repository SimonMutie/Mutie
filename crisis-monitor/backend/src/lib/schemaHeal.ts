import type { Env } from "../bindings";

/**
 * Self-healing for columns that were added by hand-run migration files.
 *
 * The database has no migration runner: each db/migration_NNN_*.sql file is
 * meant to be pasted into the D1 console once. When one is missed, every
 * statement that names the new column fails ("no such column: title") —
 * which is exactly what happened to events.title on the live database: the
 * query preview failed, and so did every insert of a fetched news article.
 *
 * So the Worker checks for these columns itself and adds any that are
 * missing. Per table that is one zero-row SELECT naming the columns; only if
 * that fails does it issue ALTER TABLE ... ADD COLUMN, one column at a time.
 * Adding a column is non-destructive: existing rows keep everything they
 * have and read NULL (or the stated default) for the new column.
 *
 * Runs once per Worker isolate; a failed check is retried on the next call.
 * Tables that do not exist are left alone — creating whole tables is the
 * job of the migration files (or, for the escalation pipeline, its own
 * CREATE TABLE IF NOT EXISTS).
 */

/** table -> [column, definition] for every column a migration added with ALTER TABLE. */
export const MIGRATED_COLUMNS: Record<string, [string, string][]> = {
  events: [["title", "TEXT"]], // migration 003
  monitoring_queries: [["owner_id", "TEXT REFERENCES users(id) ON DELETE CASCADE"]], // 002
  incidents: [["country", "TEXT"]], // 007
  custom_dashboards: [
    ["is_auto", "INTEGER NOT NULL DEFAULT 0"], // 010
    ["locked", "INTEGER NOT NULL DEFAULT 0"], // 011
    ["date_range_from", "TEXT"], // 013
    ["date_range_to", "TEXT"],
    ["theme", "TEXT"], // dashboard themes (no hand-run migration)
    ["country", "TEXT"], // a dashboard tied to one country (the Country Dashboard)
  ],
  users: [
    ["client_id", "TEXT REFERENCES clients(id) ON DELETE SET NULL"], // 014
    ["is_client_admin", "INTEGER NOT NULL DEFAULT 0"],
  ],
  clients: [
    ["can_view_all_incidents", "INTEGER NOT NULL DEFAULT 0"], // 015
    ["logo_data", "TEXT"], // 016
  ],
  map_routes: [["visible", "INTEGER NOT NULL DEFAULT 1"]], // 019
  map_shapes: [["visible", "INTEGER NOT NULL DEFAULT 1"]],
  map_default_settings: [
    ["default_filters", "TEXT"],
    ["map_center_lat", "REAL"],
    ["map_center_lng", "REAL"],
    ["map_zoom", "REAL"],
    ["position_locked", "INTEGER NOT NULL DEFAULT 0"],
  ],
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).toLowerCase();

async function healTable(env: Env, table: string, columns: [string, string][]): Promise<string[]> {
  try {
    await env.DB.prepare(`SELECT ${columns.map(([c]) => c).join(", ")} FROM ${table} LIMIT 0`).all();
    return []; // every column is there
  } catch (err) {
    const m = message(err);
    if (m.includes("no such table")) return [];
    if (!m.includes("no such column")) throw err; // an outage, not a schema gap — retry later
  }
  const added: string[] = [];
  for (const [column, definition] of columns) {
    try {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      added.push(`${table}.${column}`);
    } catch (err) {
      if (!message(err).includes("duplicate column")) throw err; // already there is fine
    }
  }
  return added;
}

let checked: Promise<void> | null = null;

export function ensureSchema(env: Env): Promise<void> {
  if (!checked) {
    checked = (async () => {
      const results = await Promise.all(Object.entries(MIGRATED_COLUMNS).map(([table, columns]) => healTable(env, table, columns)));
      const added = results.flat();
      if (added.length) console.log(`[schema] added missing columns: ${added.join(", ")}`);
    })().catch((err) => {
      checked = null; // try again on the next request or cron tick
      console.error("[schema] check failed:", err);
    });
  }
  return checked;
}

/** Test hook: forget that the check has run. */
export function resetSchemaCheck(): void {
  checked = null;
}
