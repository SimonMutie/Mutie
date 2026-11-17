import { ensureIncidentVersion, resetIncidentVersionState } from "./incidentCache";

/**
 * A slim copy of the incident table for dashboards to count from.
 *
 * Every incident row also carries its free-text details and a JSON copy of the whole spreadsheet row it came from,
 * which together are most of its size. Dashboard counts never use either, but a count over the full table still
 * reads them, so a dashboard of 30 to 50 counts over 70,000 incidents read gigabytes within seconds and the database
 * refused ("D1 DB is overloaded. Too many resources consumed within a 10 second window", Nov 2026). incident_facts
 * has every column except those two, so each count reads a fraction as much.
 *
 * It is kept identical to incidents by database triggers on insert, edit and delete, so no upload or edit path has
 * to remember it. Existing incidents are copied across in chunks by the scheduled job (advanceFactsBackfill); until
 * the copy is complete, dashboards keep counting from incidents itself (incidentTable).
 */
export const FACT_COLUMNS = [
  "id", "owner_id", "occurred_date", "occurred_time", "occurred_at", "province", "county", "district", "city", "suburb",
  "precise_location", "latitude", "longitude", "sector", "actor", "operation", "tactic", "severity", "target",
  "interest_group", "actual_main_victim", "intended_primary_target", "civilian_death_child", "civilian_death_female",
  "civilian_death_male", "civilian_death_unknown", "civilian_injury_female", "civilian_injury_male",
  "civilian_injury_unknown", "kidnappings_ngo", "upload_batch_id", "created_at", "country",
] as const;

const cols = FACT_COLUMNS.join(", ");
const newCols = FACT_COLUMNS.map((c) => `NEW.${c}`).join(", ");
let schemaReady = false;
let factsReady = false;

export async function ensureFacts(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await ensureIncidentVersion(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS incident_facts (${FACT_COLUMNS.map((c) => (c === "id" ? "id TEXT PRIMARY KEY" : c)).join(", ")})`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_incident_facts_owner ON incident_facts(owner_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_incident_facts_occurred ON incident_facts(occurred_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_incident_facts_country ON incident_facts(country)`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS incident_facts_ins AFTER INSERT ON incidents BEGIN INSERT OR REPLACE INTO incident_facts (${cols}) VALUES (${newCols}); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS incident_facts_upd AFTER UPDATE ON incidents BEGIN DELETE FROM incident_facts WHERE id = OLD.id; INSERT OR REPLACE INTO incident_facts (${cols}) VALUES (${newCols}); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS incident_facts_del AFTER DELETE ON incidents BEGIN DELETE FROM incident_facts WHERE id = OLD.id; END`),
    db.prepare(`INSERT OR IGNORE INTO incidents_meta (k, v) VALUES ('facts_cursor', 0), ('facts_ready', 0)`),
  ]);
  schemaReady = true;
}

/** Copies the next chunk of existing incidents into incident_facts; marks the copy ready when none are left. */
export async function advanceFactsBackfill(db: D1Database, chunk = 15000): Promise<{ copied: number; ready: boolean }> {
  await ensureFacts(db);
  const meta = await db.prepare(`SELECT k, v FROM incidents_meta WHERE k IN ('facts_cursor', 'facts_ready')`).all<{ k: string; v: number }>();
  const get = (k: string) => meta.results?.find((r) => r.k === k)?.v ?? 0;
  if (get("facts_ready") === 1) return { copied: 0, ready: true };
  const cursor = get("facts_cursor");
  const last = await db.prepare(`SELECT MAX(r) AS r, COUNT(*) AS n FROM (SELECT rowid AS r FROM incidents WHERE rowid > ? ORDER BY rowid LIMIT ?)`).bind(cursor, chunk).first<{ r: number | null; n: number }>();
  if (!last?.r) {
    await db.prepare(`UPDATE incidents_meta SET v = 1 WHERE k = 'facts_ready'`).run();
    return { copied: 0, ready: true };
  }
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO incident_facts (${cols}) SELECT ${cols} FROM incidents WHERE rowid > ? AND rowid <= ?`).bind(cursor, last.r),
    db.prepare(`UPDATE incidents_meta SET v = ? WHERE k = 'facts_cursor' AND v = ?`).bind(last.r, cursor),
  ]);
  return { copied: last.n, ready: false };
}

/** The table dashboard counts should read: the slim copy once it is complete, the full table until then. */
export async function incidentTable(db: D1Database): Promise<"incident_facts" | "incidents"> {
  if (factsReady) return "incident_facts";
  try {
    await ensureFacts(db);
    const row = await db.prepare(`SELECT v FROM incidents_meta WHERE k = 'facts_ready'`).first<{ v: number }>();
    if (row?.v === 1) factsReady = true;
  } catch {
    return "incidents";
  }
  return factsReady ? "incident_facts" : "incidents";
}

/** Test hook. */
export function resetIncidentFactsState(): void {
  resetIncidentVersionState();
  schemaReady = false;
  factsReady = false;
}
