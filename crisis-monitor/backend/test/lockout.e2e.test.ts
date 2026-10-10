import { describe, it, expect, beforeAll } from "vitest";
import { authRouter } from "../src/routes/auth";
import { hashPassword } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";
import { readAudit } from "../src/lib/audit";

let env: Env;
let db: ReturnType<typeof fakeD1>["db"];
const GOOD = "a-long-enough-password";

beforeAll(async () => {
  const d1 = fakeD1();
  db = d1.db;
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, display_name TEXT, role TEXT, client_id TEXT, is_client_admin INTEGER DEFAULT 0, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0, failed_logins INTEGER DEFAULT 0, locked_until TEXT, created_at TEXT);
           CREATE TABLE clients (id TEXT PRIMARY KEY, logo_data TEXT, can_share_publicly INTEGER DEFAULT 0);`);
  const hash = await hashPassword(GOOD);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u1','amina',?, 'client', 'now')").run(hash);
  db.prepare("INSERT INTO users (id, username, password_hash, role, disabled, created_at) VALUES ('u2','off',?, 'client', 1, 'now')").run(hash);
});

const login = (username: string, password: string) =>
  authRouter.request("/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }, env);

describe("sign-in lockout", () => {
  it("locks after five wrong passwords, even for the right one, then lets a right password reset the count", async () => {
    for (let i = 0; i < 4; i++) expect((await login("amina", "wrong")).status).toBe(401);
    expect((await login("amina", GOOD)).status).toBe(200); // a good sign-in resets the count
    for (let i = 0; i < 5; i++) expect((await login("amina", "wrong")).status).toBe(401);
    const locked = await login("amina", GOOD);
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { error: string }).error).toMatch(/locked/i);
    // lifting the lock (as time would) restores access
    db.prepare("UPDATE users SET locked_until = ? WHERE id = 'u1'").run(new Date(Date.now() - 1000).toISOString());
    expect((await login("amina", GOOD)).status).toBe(200);
  });
  it("refuses a disabled account with the right password", async () => {
    expect((await login("off", GOOD)).status).toBe(403);
  });
  it("records what happened", async () => {
    const actions = (await readAudit(env, { limit: 100 })).map((e) => e.action);
    expect(actions).toContain("login.ok");
    expect(actions).toContain("login.failed");
    expect(actions).toContain("login.locked");
    expect(actions).toContain("login.blocked");
  });
});
