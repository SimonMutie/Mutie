import { describe, it, expect, beforeAll } from "vitest";
import { sourceRegisterRouter } from "../src/routes/sourceRegister";
import { createSessionToken } from "../src/auth";
import { resetRegisterCheck } from "../src/lib/sourceRegister";
import { AFRICA_SOURCES } from "../src/data/africaSources";
import { SOURCE_NAMES } from "../src/data/sourceNames";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

let env: Env;
let admin: Record<string, string>;
let client: Record<string, string>;

beforeAll(async () => {
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
              INSERT INTO users (id) VALUES ('a'), ('c');`);
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}` };
  client = { Authorization: `Bearer ${await createSessionToken("c", "client", "s")}` };
  resetRegisterCheck();
});

const call = (path: string, init: RequestInit & { headers: Record<string, string> }) => sourceRegisterRouter.request(path, init, env);

describe("sources register", () => {
  it("is for the super admin only", async () => {
    expect((await call("/", { headers: client })).status).toBe(403);
    expect((await call("/", { headers: {} })).status).toBe(401);
  });

  it("seeds from the lists the platform reads, with names, regions and honest roles", async () => {
    const res = await call("/", { headers: admin });
    const body = (await res.json()) as { entries: { name: string; url: string; country: string; region: string; role: string; kind: string }[] };
    expect(body.entries.length).toBeGreaterThan(350);
    const nation = body.entries.find((e) => e.url.includes("nation.africa"))!;
    expect(nation).toMatchObject({ name: "Nation Africa (Daily Nation)", country: "KE", region: "East Africa", role: "pulled", kind: "local_media" });
    expect(body.entries.find((e) => e.url.includes("ecb") || e.name.includes("European Central"))).toBeTruthy();
    // References are labelled as such, never as pulled.
    expect(body.entries.find((e) => e.name.startsWith("ACLED"))!.role).toBe("reference");
    expect(body.entries.find((e) => e.url.includes("aps.dz"))!.kind).toBe("state_media");
    expect(new Set(body.entries.map((e) => e.url.toLowerCase().replace(/\/+$/, ""))).size).toBe(body.entries.length);
  });

  it("has a proper display name for every outlet the platform crawls", () => {
    const missing = AFRICA_SOURCES.map((x) => new URL(x.url).hostname.replace(/^www\./, "")).filter((h) => !SOURCE_NAMES[h]);
    expect(missing).toEqual([]);
  });

  it("adds, edits and removes entries", async () => {
    const add = await call("/", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ name: "Test Outlet", url: "https://example.org/news", country: "ke", kind: "local_media", role: "reference" }) });
    expect(add.status).toBe(201);
    const row = (await add.json()) as { id: string; country: string; region: string };
    expect(row).toMatchObject({ country: "KE", region: "East Africa" });
    const dup = await call("/", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ name: "Again", url: "https://EXAMPLE.org/news", country: "KE", kind: "local_media", role: "pulled" }) });
    expect(dup.status).toBe(409);
    const patch = await call(`/${row.id}`, { method: "PATCH", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ country: "UG", notes: "checked" }) });
    expect(((await patch.json()) as { region: string }).region).toBe("East Africa");
    expect((await call(`/${row.id}`, { method: "DELETE", headers: admin })).status).toBe(200);
    expect((await call("/", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ name: "x", url: "javascript:alert(1)", country: "KE", kind: "local_media", role: "pulled" }) })).status).toBe(400);
  });
});
