import { describe, it, expect, beforeEach } from "vitest";
import { candidatesIn, suggestRole, proposeFromLeads, approveProposal, rejectProposal, pendingProposals } from "../src/lib/electionProposals";
import { ensureElectionWatchTables, KE_WATCH, resetElectionWatchCheck } from "../src/lib/electionWatch";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

let env: Env;
const t = KE_WATCH.t;
const add = (id: string, kind: string, title: string, day = "2026-10-09") =>
  env.DB.prepare(`INSERT INTO ${t.leads} (id, kind, title, url, domain, published_at, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)`)
    .bind(id, kind, title, `https://news.example/${id}`, "news.example", `${day}T08:00:00Z`, `${day}T09:00:00Z`)
    .run();

beforeEach(async () => {
  resetElectionWatchCheck();
  env = { DB: fakeD1().DB } as unknown as Env;
  await ensureElectionWatchTables(env, KE_WATCH);
});

describe("candidatesIn", () => {
  it("finds named candidates in the order they appear, across apostrophe forms", () => {
    expect(candidatesIn("Gachagua picks Wetang’ula as running mate")).toEqual(["gachagua", "wetangula"]);
    expect(candidatesIn("Matiang'i backs Kalonzo ticket")).toEqual(["matiangi", "kalonzo"]);
  });

  it("does not match a surname inside another word or a bare common surname", () => {
    expect(candidatesIn("Mwangi Kariuki wins football cup")).toEqual([]);
    expect(candidatesIn("Boniface Mwangi launches campaign")).toEqual(["mwangi"]);
  });
});

describe("suggestRole", () => {
  it("reads the wording of a headline", () => {
    expect(suggestRole("Ruto names Kindiki as running mate")).toBe("deputy");
    expect(suggestRole("Sifuna backs Kalonzo for president")).toBe("backer");
    expect(suggestRole("Sifuna declares bid for presidency")).toBe("head");
  });
});

describe("proposeFromLeads", () => {
  it("files each new declaration once, closes its lead, and ignores polls", async () => {
    add("l1", "declaration", "Gachagua picks Wetang’ula as running mate");
    add("l2", "poll", "New Infotrak poll shows Ruto leading");
    const first = await proposeFromLeads(env, KE_WATCH);
    const again = await proposeFromLeads(env, KE_WATCH);
    expect(first.filed).toBe(1);
    expect(again.filed).toBe(0);
    const lead = await env.DB.prepare(`SELECT status FROM ${t.leads} WHERE id = 'l1'`).first<{ status: string }>();
    expect(lead?.status).toBe("done");
    const poll = await env.DB.prepare(`SELECT status FROM ${t.leads} WHERE id = 'l2'`).first<{ status: string }>();
    expect(poll?.status).toBe("pending");
    const pending = await pendingProposals(env, KE_WATCH);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ candidate: "gachagua", matches: ["gachagua", "wetangula"], suggestedRole: "deputy", date: "2026-10-09" });
  });
});

describe("approve and reject", () => {
  it("writes an approved change as a realignment, and only once", async () => {
    add("l1", "declaration", "Sifuna backs Kalonzo for president");
    await proposeFromLeads(env, KE_WATCH);
    const id = (await pendingProposals(env, KE_WATCH))[0].id;
    const ok = await approveProposal(env, id, { candidate: "sifuna", ticket: "A", role: "backer", date: "2026-10-09", note: "Sifuna backs the ticket", source: "news.example" }, "admin-1", KE_WATCH);
    expect(ok).toEqual({ ok: true });
    const row = await env.DB.prepare(`SELECT id, data FROM ${t.content} WHERE kind = 'realignment'`).first<{ id: string; data: string }>();
    expect(row?.id).toBe("2026-10-09-sifuna");
    expect(JSON.parse(row!.data)).toMatchObject({ candidate: "sifuna", ticket: "A", role: "backer" });
    const again = await approveProposal(env, id, { candidate: "sifuna", ticket: "A", role: "backer", date: "2026-10-09", note: "", source: "" }, "admin-1", KE_WATCH);
    expect(again).toEqual({ ok: false, status: 409, error: "This proposal has already been decided" });
    expect(await pendingProposals(env, KE_WATCH)).toHaveLength(0);
  });

  it("rejecting writes nothing to the record", async () => {
    add("l1", "declaration", "Gachagua declares bid for presidency");
    await proposeFromLeads(env, KE_WATCH);
    const id = (await pendingProposals(env, KE_WATCH))[0].id;
    expect(await rejectProposal(env, id, "admin-1", KE_WATCH)).toEqual({ ok: true });
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t.content} WHERE kind = 'realignment'`).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("returns not found for an unknown proposal", async () => {
    expect(await rejectProposal(env, "missing", "admin-1", KE_WATCH)).toEqual({ ok: false, status: 404, error: "Not found" });
  });
});
