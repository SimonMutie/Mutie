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

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
