/** A minimal stand-in for a D1 database over node:sqlite, for tests that
 *  only need the database to exist (for example to count AI usage). */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

class Stmt {
  constructor(private db: InstanceType<typeof DatabaseSync>, private sql: string, private params: unknown[] = []) {}
  bind(...params: unknown[]) {
    return new Stmt(this.db, this.sql, params);
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) as T) ?? null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { meta: { changes: Number(r.changes) } };
  }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  return { db, DB: { prepare: (sql: string) => new Stmt(db, sql) } };
}
