/**
 * Thin D1 helpers. D1's `.bind()` rejects `undefined` (only `null` is
 * accepted for "no value"), so every call sanitizes params through this.
 */
function sanitize(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...sanitize(params))
    .all<T>();
  return res.results ?? [];
}

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...sanitize(params))
    .first<T>();
}

export async function run(db: D1Database, sql: string, params: unknown[] = []): Promise<void> {
  await db
    .prepare(sql)
    .bind(...sanitize(params))
    .run();
}

/** Runs many prepared statements as a single D1 batch (one round trip) instead of
 *  awaiting inserts one at a time — used for bulk incident uploads, which can be
 *  hundreds of rows from one spreadsheet. D1 batches are wrapped in an implicit
 *  transaction (all succeed or all roll back). */
export async function batchRun(db: D1Database, statements: { sql: string; params: unknown[] }[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...sanitize(params))));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
