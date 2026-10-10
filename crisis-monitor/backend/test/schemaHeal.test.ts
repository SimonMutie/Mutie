/**
 * The live database was missing events.title (migration 003 was never run),
 * which broke the query preview and every news-article insert. The Worker
 * now adds such columns itself.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { ensureSchema, resetSchemaCheck } from "../src/lib/schemaHeal";
import type { Env } from "../src/bindings";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function makeEnv(db: InstanceType<typeof DatabaseSync>, log: string[] = []): Env {
  const stmt = (sql: string) => ({
    all: async () => (log.push(sql), { results: db.prepare(sql).all() }),
    run: async () => (log.push(sql), db.prepare(sql).run()),
  });
  return { DB: { prepare: stmt } } as unknown as Env;
}
const columns = (db: InstanceType<typeof DatabaseSync>, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

beforeEach(() => resetSchemaCheck());

describe("schema self-heal", () => {
  it("adds events.title to a database that never had it, keeping existing rows", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE events (id TEXT PRIMARY KEY, content TEXT NOT NULL); INSERT INTO events VALUES ('e1', 'old article');");
    expect(() => db.prepare("SELECT id, title FROM events").all()).toThrow(/no such column: title/);
    await ensureSchema(makeEnv(db));
    expect(db.prepare("SELECT id, title, content FROM events").all()).toEqual([{ id: "e1", title: null, content: "old article" }]);
  });

  it("adds only what is missing, with defaults, and skips tables that do not exist", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE custom_dashboards (id TEXT PRIMARY KEY, is_auto INTEGER NOT NULL DEFAULT 0); INSERT INTO custom_dashboards (id) VALUES ('d1');");
    await ensureSchema(makeEnv(db));
    expect(columns(db, "custom_dashboards")).toEqual(["id", "is_auto", "locked", "date_range_from", "date_range_to", "theme", "country", "share_expires_at"]);
    expect(db.prepare("SELECT locked FROM custom_dashboards").get()).toEqual({ locked: 0 });
  });

  it("changes nothing on a complete database, and checks only once", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT, content TEXT NOT NULL);");
    const log: string[] = [];
    const env = makeEnv(db, log);
    await ensureSchema(env);
    await ensureSchema(env);
    expect(log.some((sql) => sql.startsWith("ALTER"))).toBe(false);
    expect(log.filter((sql) => sql.includes("FROM events"))).toHaveLength(1);
  });
});
