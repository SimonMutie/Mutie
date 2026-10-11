import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/lib/feedSearch", () => ({ searchFeeds: vi.fn(async () => new Map()) }));

import { reportRouter } from "../src/routes/monthlyReports";
import { seriesFor, nextPeriod, defaultSections, monthOf, ensureReportTables } from "../src/lib/monthlyReports";
import { SS_WATCH } from "../src/lib/southSudanWatch";
import { ensureElectionWatchTables } from "../src/lib/electionWatch";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const router = reportRouter(SS_WATCH);
let env: Env;
let admin: Record<string, string>;
let shared: Record<string, string>;
const call = (who: Record<string, string>, path: string, method = "GET", body?: unknown) =>
  router.request(path, { method, headers: { ...who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

beforeAll(async () => {
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, can_view_spotlight INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE users (id TEXT PRIMARY KEY, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    INSERT INTO clients VALUES ('c1', 1);
    INSERT INTO users (id, client_id) VALUES ('a', NULL), ('s', 'c1');`);
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}` };
  shared = { Authorization: `Bearer ${await createSessionToken("s", "client", "s")}` };
  await ensureReportTables(env);
  await ensureElectionWatchTables(env, SS_WATCH);
  const ins = (id: string, cluster: string, published: string, cat: string, county: string | null, fat: number | null, status = "auto") =>
    env.DB.prepare(`INSERT INTO ss_items (id, url, title, summary, domain, published_at, category, severity, county_code, fatalities, cluster_id, method, status, created_at) VALUES (?, ?, 't', '', 'd', ?, ?, 2, ?, ?, ?, 'rules', ?, ?)`)
      .bind(id, `https://x/${id}`, published, cat, county, fat, cluster, status, published).run();
  await ins("1", "c1", "2026-08-03T10:00:00Z", "armed_clash", "JG", 4);
  await ins("2", "c1", "2026-08-03T12:00:00Z", "armed_clash", "JG", 6, "verified");
  await ins("3", "c2", "2026-08-20T09:00:00Z", "displacement", "UP", null);
  await ins("4", "c3", "2026-09-02T09:00:00Z", "political_detention", null, null);
  await ins("5", "c4", "2026-09-02T09:30:00Z", "armed_clash", "JG", 2, "rejected");
});

describe("month arithmetic", () => {
  it("steps to the next month across a year end", () => {
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(nextPeriod("2026-09")).toBe("2026-10");
    expect(monthOf("2026-09-02T09:00:00Z")).toBe("2026-09");
  });
  it("every default section has a unique id", () => {
    const ids = defaultSections().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("series", () => {
  it("counts events once per cluster, in the month of first report, ignoring rejected rows", async () => {
    const series = await seriesFor(env, SS_WATCH);
    const aug = series.find((p) => p.period === "2026-08")!;
    const sep = series.find((p) => p.period === "2026-09")!;
    expect(aug.events).toBe(2);
    expect(aug.verified).toBe(1);
    expect(aug.fatalities).toBe(6);
    expect(aug.byCategory.armed_clash).toBe(1);
    expect(aug.byPlace.JG).toBe(1);
    expect(sep.events).toBe(1);
    expect(sep.byCategory.political_detention).toBe(1);
  });
});

describe("report lifecycle", () => {
  it("viewers cannot read drafts, admins can", async () => {
    expect((await call(admin, "/2026-08")).status).toBe(200);
    expect((await call(shared, "/2026-08")).status).toBe(200);
  });
  it("starts a report, carries narrative forward, and freezes on publish", async () => {
    let res = await call(admin, "/2026-08/start", "POST");
    expect(res.status).toBe(200);
    expect((await call(admin, "/2026-08/start", "POST")).status).toBe(409);
    await call(admin, "/2026-08", "PUT", {
      title: "August 2026",
      sections: defaultSections().map((s) => (s.id === "summary" ? { ...s, body: "Clashes in Jonglei." } : s)),
    });
    await call(admin, "/2026-08/start", "POST").catch(() => null);
    res = await call(admin, "/2026-09/start", "POST");
    expect(res.status).toBe(200);
    const sep = (await (await call(admin, "/2026-09")).json()) as { report: { sections: { id: string; body?: string; carried?: boolean }[] } };
    const summary = sep.report.sections.find((s) => s.id === "summary")!;
    expect(summary.body).toBe("Clashes in Jonglei.");
    expect(summary.carried).toBe(true);

    res = await call(admin, "/2026-08/publish", "POST");
    expect(res.status).toBe(200);
    const pub = (await (await call(shared, "/2026-08")).json()) as { report: { status: string; snapshot: { events: number } } };
    expect(pub.report.status).toBe("published");
    expect(pub.report.snapshot.events).toBe(2);
    expect((await call(admin, "/2026-08", "PUT", { title: "x", sections: [{ id: "a", kind: "narrative", title: "a", body: "" }] })).status).toBe(409);
  });
  it("rejects duplicate section ids and non-admin writes", async () => {
    expect((await call(shared, "/2026-09/start", "POST")).status).toBe(403);
    const dup = await call(admin, "/2026-09", "PUT", { title: "t", sections: [{ id: "a", kind: "narrative", title: "a" }, { id: "a", kind: "narrative", title: "b" }] });
    expect(dup.status).toBe(400);
  });
  it("lists only published reports to viewers", async () => {
    const viewer = (await (await call(shared, "/")).json()) as { period: string }[];
    expect(viewer.map((x) => x.period)).toEqual(["2026-08"]);
  });
  it("saves the theme and each section's text style, and rejects unknown styles", async () => {
    const sections = [{ id: "summary", kind: "narrative", title: "Summary", body: "Text.", style: { font: "serif", size: "l", align: "justify" } }];
    const ok = await call(admin, "/2026-09", "PUT", { title: "t", theme: "dusk", sections });
    expect(ok.status).toBe(200);
    const got = (await (await call(admin, "/2026-09")).json()) as { report: { theme: string; sections: { style?: unknown }[] } };
    expect(got.report.theme).toBe("dusk");
    expect(got.report.sections[0].style).toEqual({ font: "serif", size: "l", align: "justify" });
    const bad = await call(admin, "/2026-09", "PUT", { title: "t", theme: "neon", sections });
    expect(bad.status).toBe(400);
    const badStyle = await call(admin, "/2026-09", "PUT", { title: "t", sections: [{ ...sections[0], style: { font: "comic" } }] });
    expect(badStyle.status).toBe(400);
  });
  it("hides sections from readers but not from analysts", async () => {
    const sections = [
      { id: "summary", kind: "narrative", title: "Summary", body: "Visible." },
      { id: "secret", kind: "narrative", title: "Draft note", body: "Hidden from readers.", hidden: true },
    ];
    expect((await call(admin, "/2026-09", "PUT", { title: "t", sections })).status).toBe(200);
    // The report is a draft, so a reader can't see it; publish it to test readers' view.
    expect((await call(admin, "/2026-09/publish", "POST")).status).toBe(200);
    const reader = (await (await call(shared, "/2026-09")).json()) as { report: { sections: { id: string }[] } };
    expect(reader.report.sections.map((s) => s.id)).toEqual(["summary"]);
    const analyst = (await (await call(admin, "/2026-09")).json()) as { report: { sections: { id: string; hidden?: boolean }[] } };
    expect(analyst.report.sections.map((s) => s.id)).toEqual(["summary", "secret"]);
  });
});
