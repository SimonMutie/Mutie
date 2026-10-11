import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/lib/feedSearch", () => ({ searchFeeds: vi.fn(async () => new Map()) }));

import { reportRouter, publicReportRouter } from "../src/routes/monthlyReports";
import { ensureReportTables, insertReport, saveReport, defaultSections } from "../src/lib/monthlyReports";
import { SS_WATCH } from "../src/lib/southSudanWatch";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const router = reportRouter(SS_WATCH);
let env: Env;
let admin: Record<string, string>;
let token: string;

const adminCall = (path: string, method = "GET", body?: unknown) =>
  router.request(path, { method, headers: { ...admin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
const publicCall = (path: string) => publicReportRouter.request(path, {}, env);

beforeAll(async () => {
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, can_view_spotlight INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE users (id TEXT PRIMARY KEY, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    INSERT INTO users (id, client_id) VALUES ('a', NULL);`);
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}` };
  await ensureReportTables(env);
  const sections = defaultSections();
  await insertReport(env, { country: "ss", period: "2026-09", title: "September", sections, by: "a" });
  await saveReport(env, "ss", "2026-09", { title: "September", theme: "lens", sections }, "a");
  await env.DB.prepare(`UPDATE monthly_reports SET status = 'published' WHERE country = 'ss' AND period = '2026-09'`).run();
});

describe("report share links", () => {
  it("refuses to share a report that is not published", async () => {
    await insertReport(env, { country: "ss", period: "2026-07", title: "July", sections: defaultSections(), by: "a" });
    const res = await adminCall("/2026-07/share", "POST", {});
    expect(res.status).toBe(409);
  });

  it("creates a token for a published report and serves it publicly without sign-in", async () => {
    const res = await adminCall("/2026-09/share", "POST", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; path: string };
    token = body.token;
    expect(body.path).toBe(`/shared-report/${token}`);
    const pub = await publicCall(`/${token}`);
    expect(pub.status).toBe(200);
    const data = (await pub.json()) as { country: string; report: { sections: unknown[] }; section_id: string | null };
    expect(data.country).toBe("ss");
    expect(data.section_id).toBeNull();
    expect(data.report.sections.length).toBe(defaultSections().length);
  });

  it("limits a section link to that section and leaves hidden sections out", async () => {
    const id = defaultSections()[1].id;
    const res = await adminCall("/2026-09/share", "POST", { section_id: id });
    const { token: t } = (await res.json()) as { token: string };
    const data = (await (await publicCall(`/${t}`)).json()) as { report: { sections: { id: string }[] } };
    expect(data.report.sections.map((s) => s.id)).toEqual([id]);
  });

  it("stops working once revoked", async () => {
    const res = await adminCall(`/2026-09/shares/${token}`, "DELETE");
    expect(res.status).toBe(200);
    expect((await publicCall(`/${token}`)).status).toBe(404);
  });

  it("does not let a reader create or list links", async () => {
    const nobody = { Authorization: `Bearer ${await createSessionToken("zz", "client", "s")}` };
    const res = await router.request("/2026-09/share", { method: "POST", headers: nobody }, env);
    expect([401, 403]).toContain(res.status);
  });
});
