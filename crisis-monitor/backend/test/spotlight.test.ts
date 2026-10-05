/**
 * Regional Spotlight through its real routes, against an in-memory database
 * that starts EMPTY — the table must be created by the Worker itself.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { spotlightRouter, publicSpotlightRouter, resetSpotlightTableCheck } from "../src/routes/spotlight";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

class FakeStmt {
  constructor(private db: InstanceType<typeof DatabaseSync>, private sql: string, private params: unknown[] = []) {}
  bind(...params: unknown[]) {
    return new FakeStmt(this.db, this.sql, params);
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) as T) ?? null;
  }
  async run() {
    return this.db.prepare(this.sql).run(...(this.params as never[]));
  }
}

let env: Env;
let admin: Record<string, string>;
let client: Record<string, string>;
const call = (who: Record<string, string>, method: string, path: string, body?: unknown) =>
  spotlightRouter.request(path, { method, headers: { ...who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

interface Entry {
  id: string;
  region: string;
  title: string;
  status: string;
  is_public: boolean;
  published_at: string | null;
  publication_date: string;
  body?: string;
  link_url: string | null;
}

beforeAll(async () => {
  resetSpotlightTableCheck();
  const db = new DatabaseSync(":memory:");
  env = { DB: { prepare: (sql: string) => new FakeStmt(db, sql) }, SESSION_SECRET: "test-secret" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("u-admin", "admin", "test-secret")}` };
  client = { Authorization: `Bearer ${await createSessionToken("u-client", "client", "test-secret")}` };
});

describe("Regional Spotlight", () => {
  let draftId = "";
  let liveId = "";

  it("works on a database that has never seen it, and requires signing in", async () => {
    expect((await spotlightRouter.request("/", {}, env)).status).toBe(401);
    expect(await json(call(client, "GET", "/"))).toEqual([]);
    const regions = await json<{ slug: string; name: string; published: number; drafts: number }[]>(call(admin, "GET", "/regions"));
    expect(regions.map((r) => r.name)).toEqual(["Africa", "Asia-Pacific", "Europe & Central Asia", "Latin America & the Caribbean", "Middle East", "United States & Canada"]);
    expect(regions.every((r) => r.published === 0 && r.drafts === 0)).toBe(true);
  });

  it("lets only an admin add entries — as many as wanted per region", async () => {
    expect((await call(client, "POST", "/", { region: "africa", title: "Not allowed" })).status).toBe(403);

    const draft = await json<Entry>(call(admin, "POST", "/", { region: "africa", title: "Sudan: El Fasher after the siege", product_type: "Situation Update", body: "## Overview\n\nText.", publication_date: "2026-10-01" }));
    draftId = draft.id;
    expect(draft).toMatchObject({ region: "africa", status: "draft", is_public: false, published_at: null });

    const live = await json<Entry>(call(admin, "POST", "/", { region: "africa", title: "Sahel monthly overview", status: "published", link_url: "https://example.org/report.pdf" }));
    liveId = live.id;
    expect(live.status).toBe("published");
    expect(live.published_at).toBeTruthy();
    expect(live.publication_date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // defaults to today

    for (let i = 0; i < 30; i++) await call(admin, "POST", "/", { region: "middle-east", title: `Yemen update ${i}`, status: "published" });
    const regions = await json<{ slug: string; published: number; drafts: number }[]>(call(admin, "GET", "/regions"));
    expect(regions.find((r) => r.slug === "africa")).toMatchObject({ published: 1, drafts: 1 });
    expect(regions.find((r) => r.slug === "middle-east")).toMatchObject({ published: 30, drafts: 0 });
  });

  it("rejects bad input with a readable reason", async () => {
    const noTitle = await call(admin, "POST", "/", { region: "africa", title: "  " });
    expect(noTitle.status).toBe(400);
    expect(await json(noTitle)).toEqual({ error: "Title is required" });
    expect(await json(call(admin, "POST", "/", { region: "atlantis", title: "x" }))).toHaveProperty("error");
    // Links become clickable, so only real web addresses are stored.
    const badLink = await json<{ error: string }>(call(admin, "PATCH", `/${draftId}`, { link_url: "javascript:alert(1)" }));
    expect(badLink.error).toBe("Link address must be a web address starting with http:// or https://");
  });

  it("shows drafts to admins only", async () => {
    const adminList = await json<Entry[]>(call(admin, "GET", "/?region=africa"));
    expect(adminList.map((e) => e.title).sort()).toEqual(["Sahel monthly overview", "Sudan: El Fasher after the siege"]);
    expect(adminList[0]).not.toHaveProperty("body"); // the list is light; text comes with the single entry

    const clientList = await json<Entry[]>(call(client, "GET", "/?region=africa"));
    expect(clientList.map((e) => e.title)).toEqual(["Sahel monthly overview"]);
    expect((await call(client, "GET", `/${draftId}`)).status).toBe(404);
    expect((await json<Entry>(call(admin, "GET", `/${draftId}`))).body).toBe("## Overview\n\nText.");

    const clientRegions = await json<{ slug: string; drafts: number }[]>(call(client, "GET", "/regions"));
    expect(clientRegions.find((r) => r.slug === "africa")!.drafts).toBe(0);
    expect((await call(client, "GET", "/?region=atlantis")).status).toBe(400);
  });

  it("publishing makes an entry live for signed-in users; unpublishing takes it down", async () => {
    expect((await call(client, "PATCH", `/${draftId}`, { status: "published" })).status).toBe(403);
    const published = await json<Entry>(call(admin, "PATCH", `/${draftId}`, { status: "published" }));
    expect(published.published_at).toBeTruthy();
    expect((await call(client, "GET", `/${draftId}`)).status).toBe(200);

    const down = await json<Entry>(call(admin, "PATCH", `/${draftId}`, { status: "draft", title: "Sudan: El Fasher after the siege (revised)" }));
    expect(down.title).toMatch(/revised/);
    expect(down.published_at).toBe(published.published_at); // first publication time is kept
    expect((await call(client, "GET", `/${draftId}`)).status).toBe(404);
  });

  it("the public link opens only while the entry is both published and public", async () => {
    const open = (id: string) => publicSpotlightRouter.request(`/${id}`, {}, env);
    expect((await open(liveId)).status).toBe(404); // published, but not public
    await call(admin, "PATCH", `/${liveId}`, { is_public: true });
    const res = await open(liveId);
    expect(res.status).toBe(200);
    const body = await json<Record<string, unknown>>(res);
    expect(body.title).toBe("Sahel monthly overview");
    expect(body).not.toHaveProperty("created_by");

    await call(admin, "PATCH", `/${draftId}`, { is_public: true }); // public flag on a draft exposes nothing
    expect((await open(draftId)).status).toBe(404);
    await call(admin, "PATCH", `/${liveId}`, { status: "draft" });
    expect((await open(liveId)).status).toBe(404);
  });

  it("deletes", async () => {
    expect((await call(client, "DELETE", `/${draftId}`)).status).toBe(403);
    expect((await call(admin, "DELETE", `/${draftId}`)).status).toBe(200);
    expect((await call(admin, "GET", `/${draftId}`)).status).toBe(404);
    expect((await call(admin, "DELETE", `/${draftId}`)).status).toBe(404);
  });
});
