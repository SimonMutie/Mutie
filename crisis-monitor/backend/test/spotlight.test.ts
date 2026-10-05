/**
 * Regional Spotlight through its real routes, against an in-memory database
 * that starts EMPTY — the table must be created by the Worker itself.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { spotlightRouter, publicSpotlightRouter, resetSpotlightTableCheck, MEDIA_MAX_BYTES } from "../src/routes/spotlight";
import { validateSpotlightDoc } from "../src/lib/spotlightDoc";
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

/* ── formatted articles: document checks, page width, images ─────────── */

const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const para = (text: string, marks?: unknown[]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });

describe("formatted article documents", () => {
  it("accepts everything the editor can produce", () => {
    const body = doc(
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Overview" }] },
      para("Styled", [{ type: "bold" }, { type: "underline" }, { type: "textStyle", attrs: { color: "#d1352b" } }, { type: "highlight", attrs: { color: "rgb(255, 243, 163)" } }]),
      para("A link", [{ type: "link", attrs: { href: "https://example.org/a", target: "_blank" } }]),
      para("Email", [{ type: "link", attrs: { href: "mailto:info@example.org" } }]),
      { type: "bulletList", content: [{ type: "listItem", content: [para("point")] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [para("Actor")] }, { type: "tableCell", content: [para("Events")] }] }] },
      { type: "callout", content: [para("Key takeaway")] },
      { type: "figure", attrs: { src: "https://api.example.org/api/public/spotlight/media/abc", caption: "Map 1", width: 80, align: "center" } },
      { type: "embed", attrs: { kind: "dashboard", token: "Xy_12-abcDEF", height: 600 } },
      { type: "embed", attrs: { kind: "external", src: "https://datawrapper.dwcdn.net/abc/1/", height: 480 } },
      { type: "horizontalRule" }
    );
    expect(validateSpotlightDoc(body)).toBeNull();
  });

  it("refuses unsafe addresses, unknown blocks and non-colours, with a reason", () => {
    expect(validateSpotlightDoc(doc(para("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])))).toMatch(/link/);
    expect(validateSpotlightDoc(doc({ type: "figure", attrs: { src: "data:image/svg+xml;base64,AAAA" } }))).toMatch(/image/);
    expect(validateSpotlightDoc(doc({ type: "embed", attrs: { kind: "external", src: "http://insecure.example/x" } }))).toMatch(/https/);
    expect(validateSpotlightDoc(doc({ type: "embed", attrs: { kind: "dashboard", token: "../../admin" } }))).toMatch(/dashboard/);
    expect(validateSpotlightDoc(doc({ type: "iframe", attrs: { srcdoc: "<script>" } }))).toMatch(/does not support/);
    expect(validateSpotlightDoc(doc(para("x", [{ type: "textStyle", attrs: { color: "red; background: url(https://evil.example)" } }])))).toMatch(/colour/);
    expect(validateSpotlightDoc('{"type":"doc","content":"nope"}')).toMatch(/invalid contents/);
    expect(validateSpotlightDoc('{"type":"doc"')).toMatch(/not a valid document/);
  });

  it("is enforced when saving, and plain text is still accepted as text", async () => {
    const bad = await call(admin, "POST", "/", { region: "africa", title: "Bad", body: doc(para("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("Text contains a link that is not a web or email address");

    const good = await json<Entry & { layout_width: string }>(call(admin, "POST", "/", { region: "africa", title: "Formatted", body: doc(para("Hello")) }));
    expect(good.layout_width).toBe("wide"); // default
    const wide = await json<Entry & { layout_width: string }>(call(admin, "PATCH", `/${good.id}`, { layout_width: "full" }));
    expect(wide.layout_width).toBe("full");
    expect((await call(admin, "PATCH", `/${good.id}`, { layout_width: "enormous" })).status).toBe(400);
    expect((await call(admin, "PATCH", `/${good.id}`, { body: doc({ type: "script" }) })).status).toBe(400);

    const plain = await json<Entry>(call(admin, "POST", "/", { region: "africa", title: "Plain", body: "{ not a doc, just text with a brace" }));
    expect(plain.body).toBe("{ not a doc, just text with a brace");
  });
});

describe("article images", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 250, 251, 252]);
  const upload = (who: Record<string, string>, bytes: Uint8Array, type = "image/png") => spotlightRouter.request("/media", { method: "POST", headers: { ...who, "content-type": type }, body: bytes }, env);

  it("stores an uploaded image and serves back exactly the same bytes", async () => {
    expect((await upload(client, PNG)).status).toBe(403);
    const res = await upload(admin, PNG);
    expect(res.status).toBe(201);
    const saved = (await res.json()) as { id: string; path: string; mime: string; size: number };
    expect(saved).toMatchObject({ mime: "image/png", size: PNG.length });
    expect(saved.path).toBe(`/api/public/spotlight/media/${saved.id}`);

    const served = await publicSpotlightRouter.request(`/media/${saved.id}`, {}, env); // no sign-in
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toMatch(/immutable/);
    expect([...new Uint8Array(await served.arrayBuffer())]).toEqual([...PNG]);
    expect((await publicSpotlightRouter.request("/media/does-not-exist", {}, env)).status).toBe(404);
  });

  it("goes by what the file is, not what it claims to be, and enforces the size limit", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(admin, svg, "image/png")).status).toBe(415);
    const jpegClaimingPng = await upload(admin, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), "image/png");
    expect(((await jpegClaimingPng.json()) as { mime: string }).mime).toBe("image/jpeg");
    const big = new Uint8Array(MEDIA_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    expect((await upload(admin, big)).status).toBe(413);
    expect((await upload(admin, new Uint8Array(0))).status).toBe(400);
  });

  it("holds an image at the size limit within one database row", async () => {
    const full = new Uint8Array(MEDIA_MAX_BYTES).fill(7);
    full.set([0x89, 0x50, 0x4e, 0x47]);
    const saved = (await (await upload(admin, full)).json()) as { id: string };
    const served = await publicSpotlightRouter.request(`/media/${saved.id}`, {}, env);
    const back = new Uint8Array(await served.arrayBuffer());
    expect(back.length).toBe(MEDIA_MAX_BYTES);
    expect(Math.ceil(MEDIA_MAX_BYTES / 3) * 4).toBeLessThan(1_900_000); // base64 size, under the 2 MB row limit
  });
});

describe("upgrading the first version of the table", () => {
  it("adds the page-width column to a table created before it existed, keeping entries", async () => {
    resetSpotlightTableCheck();
    const old = new DatabaseSync(":memory:");
    old.exec(`CREATE TABLE spotlight_entries (id TEXT PRIMARY KEY, region TEXT NOT NULL, title TEXT NOT NULL, product_type TEXT NOT NULL DEFAULT 'Analysis', countries TEXT, summary TEXT, body TEXT,
      cover_image_url TEXT, link_url TEXT, link_label TEXT, author TEXT, publication_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', is_public INTEGER NOT NULL DEFAULT 0,
      published_at TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO spotlight_entries (id, region, title, publication_date, status, created_at, updated_at) VALUES ('old1', 'africa', 'Written yesterday', '2026-10-05', 'published', 'x', 'x');`);
    const oldEnv = { DB: { prepare: (sql: string) => new FakeStmt(old, sql) }, SESSION_SECRET: "test-secret" } as unknown as Env;
    const list = (await (await spotlightRouter.request("/?region=africa", { headers: admin }, oldEnv)).json()) as { title: string; layout_width: string }[];
    expect(list).toEqual([expect.objectContaining({ title: "Written yesterday", layout_width: "wide" })]);
    resetSpotlightTableCheck();
  });
});

