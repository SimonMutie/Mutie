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
  d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
              INSERT INTO users (id, username) VALUES ('a', 'admin'), ('c', 'client');`);
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

  it("rates sources honestly: wires B, official data A, state outlets flagged, unknowns not guessed", async () => {
    const res = await call("/", { headers: admin });
    const body = (await res.json()) as { entries: { name: string; url: string; reliability: string; ownership: string; rating_basis: string }[] };
    const by = (frag: string) => body.entries.find((e) => e.url.includes(frag))!;
    expect(by("reuters.com")).toMatchObject({ reliability: "B", ownership: "independent" });
    expect(by("frankfurter")).toMatchObject({ reliability: "A", ownership: "data" });
    expect(by("tass.com")).toMatchObject({ reliability: "D", ownership: "state" });
    expect(by("aps.dz")).toMatchObject({ ownership: "state" });
    expect(by("herald.co.zw")).toMatchObject({ reliability: "D", ownership: "state" });
    expect(by("gdeltproject")).toMatchObject({ reliability: "C" });
    // Nothing is left without a grade, and anything not individually assessed is F, never an invented grade.
    for (const e of body.entries) {
      expect(["A", "B", "C", "D", "E", "F"]).toContain(e.reliability);
      if (e.rating_basis === "unassessed") expect(e.reliability).toBe("F");
    }
    // The grades are not all the same: the register discriminates.
    expect(new Set(body.entries.map((e) => e.reliability)).size).toBeGreaterThanOrEqual(4);
  });

  it("records who reviewed a rating and when", async () => {
    const list = (await (await call("/", { headers: admin })).json()) as { entries: { id: string; url: string }[] };
    const id = list.entries.find((e) => e.url.includes("punchng"))!.id;
    const res = await call(`/${id}`, { method: "PATCH", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ reliability: "B", rating_note: "Reviewed against 12 months of coverage." }) });
    const row = (await res.json()) as { reliability: string; rating_basis: string; rated_by: string; rated_at: string };
    expect(row).toMatchObject({ reliability: "B", rating_basis: "reviewed", rated_by: "admin" });
    expect(row.rated_at).toBeTruthy();
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

import { EXPANSION, RERATED } from "../src/data/registerExpansion";
import { vi } from "vitest";

describe("register expansion and link checks", () => {
  it("every researched outlet is well formed and rated", () => {
    expect(EXPANSION.length).toBeGreaterThan(300);
    const hosts = new Set<string>();
    for (const [country, name, url, , rel] of EXPANSION) {
      expect(country).toMatch(/^[A-Z]{2,5}$/);
      expect(name.length).toBeGreaterThan(1);
      expect(url).toMatch(/^https?:\/\/[^/]+\/$/);
      expect("ABCDEF").toContain(rel);
      const h = new URL(url).hostname.replace(/^www\./, "");
      expect(hosts.has(h)).toBe(false);
      hosts.add(h);
    }
    for (const [host] of RERATED) expect(host).not.toContain("/");
  });

  it("adds them to the register as references, with their own ratings", async () => {
    const body = (await (await call("/", { headers: admin })).json()) as { entries: { url: string; role: string; reliability: string; rating_basis: string }[] };
    const [, , url, , rel] = EXPANSION[0];
    const row = body.entries.find((e) => e.url === url)!;
    expect(row.role).toBe("reference");
    expect(row.reliability).toBe(rel);
    expect(body.entries.length).toBeGreaterThan(700);
  });

  it("checks links in batches and tells dead from bot-blocked", async () => {
    const fake = vi.fn(async (u: string | URL | Request) => {
      const url = String(u);
      if (url.includes("nation.africa")) return new Response("ok", { status: 200 });
      if (url.includes("aps.dz")) return new Response("no", { status: 403 });
      return new Response("gone", { status: 404 });
    });
    vi.stubGlobal("fetch", fake);
    try {
      const first = (await (await call("/check-links", { method: "POST", headers: admin })).json()) as { checked: number; remaining: number };
      expect(first.checked).toBe(20);
      expect(first.remaining).toBeGreaterThan(600);
      const all = (await (await call("/", { headers: admin })).json()) as { entries: { link_status: string | null }[] };
      expect(all.entries.filter((e) => e.link_status === "dead").length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
