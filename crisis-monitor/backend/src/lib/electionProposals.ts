import type { Env } from "../bindings";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { ensureElectionWatchTables, KE_WATCH, type Watch } from "./electionWatch";

/**
 * Proposed changes to the 2027 simulator, filed from news.
 *
 * Each day's collection leaves declarations in the leads queue. This step turns
 * each new declaration into a proposal: the headline, its source, the candidate it
 * names and a suggested role. A proposal does not reach the simulator. A person
 * approves it, chooses the ticket and role, and only then is it written as a
 * realignment. Nothing a headline says is published without that approval.
 */

export type ProposedRole = "head" | "deputy" | "backer";

/** Names a headline may use for each candidate, normalised. Surnames alone are too loose for some (Mwangi, Wanga). */
export const CANDIDATE_NAMES: { id: string; names: string[] }[] = [
  { id: "ruto", names: ["william ruto", "ruto"] },
  { id: "kalonzo", names: ["kalonzo"] },
  { id: "gachagua", names: ["gachagua"] },
  { id: "matiangi", names: ["matiangi", "matiang i"] },
  { id: "sifuna", names: ["sifuna"] },
  { id: "karua", names: ["karua"] },
  { id: "maraga", names: ["maraga"] },
  { id: "wamalwa", names: ["wamalwa"] },
  { id: "muturi", names: ["muturi"] },
  { id: "omtatah", names: ["omtatah"] },
  { id: "mwangi", names: ["boniface mwangi"] },
  { id: "wajackoyah", names: ["wajackoyah"] },
  { id: "kindiki", names: ["kindiki"] },
  { id: "mudavadi", names: ["mudavadi"] },
  { id: "wetangula", names: ["wetangula", "wetang ula"] },
  { id: "waiguru", names: ["waiguru"] },
  { id: "wanga", names: ["gladys wanga"] },
  { id: "oparanya", names: ["oparanya"] },
  { id: "joho", names: ["joho"] },
];

/** Lower-case, apostrophes and punctuation as spaces, single spaces. Makes Matiang’i and Matiang'i the same. */
export const normaliseName = (s: string) => s.toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Every candidate a headline names, in the order they appear. */
export function candidatesIn(title: string): string[] {
  const t = ` ${normaliseName(title)} `;
  const hits: { id: string; at: number }[] = [];
  for (const c of CANDIDATE_NAMES) {
    let best = -1;
    for (const n of c.names) {
      const at = t.indexOf(` ${normaliseName(n)} `);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    if (best >= 0) hits.push({ id: c.id, at: best });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

/** A suggested role from the wording of a headline. A person confirms it; it is a starting point, not a verdict. */
export function suggestRole(title: string): ProposedRole {
  const t = title.toLowerCase();
  if (/running mate|deputy|as (his|her) running|picks? .* as /.test(t)) return "deputy";
  if (/\b(backs?|endorses?|endorsed|joins?|joining|allies with|pledges? support|throws? (his|her) weight)\b/.test(t)) return "backer";
  return "head";
}

export interface ProposalData {
  title: string;
  url: string;
  domain: string | null;
  date: string;
  /** The first candidate the headline names, if any. */
  candidate: string | null;
  /** Every candidate the headline names. */
  matches: string[];
  suggestedRole: ProposedRole;
}

/** Turns each new declaration lead into a proposal. Safe to run repeatedly: a lead is filed once. */
export async function proposeFromLeads(env: Env, W: Watch = KE_WATCH): Promise<{ filed: number }> {
  await ensureElectionWatchTables(env, W);
  const leads = await all<{ id: string; title: string; url: string; domain: string | null; published_at: string }>(
    env.DB,
    `SELECT id, title, url, domain, published_at FROM ${W.t.leads} WHERE kind = 'declaration' AND status = 'pending' ORDER BY published_at LIMIT 50`,
  );
  let filed = 0;
  for (const l of leads) {
    const matches = candidatesIn(l.title);
    const data: ProposalData = {
      title: l.title,
      url: l.url,
      domain: l.domain,
      date: l.published_at.slice(0, 10),
      candidate: matches[0] ?? null,
      matches,
      suggestedRole: suggestRole(l.title),
    };
    const exists = await first<{ id: string }>(env.DB, `SELECT id FROM ${W.t.proposals} WHERE lead_id = ?`, [l.id]);
    if (!exists) {
      await run(env.DB, `INSERT INTO ${W.t.proposals} (id, kind, lead_id, status, data, created_at) VALUES (?, 'realignment', ?, 'pending', ?, ?)`, [newId(), l.id, JSON.stringify(data), nowIso()]);
      filed++;
    }
    // Filed (or already filed): take it off the leads queue so it is not counted twice.
    await run(env.DB, `UPDATE ${W.t.leads} SET status = 'done' WHERE id = ?`, [l.id]);
  }
  return { filed };
}

export interface ApprovedChange {
  candidate: string;
  ticket: string | null;
  role: ProposedRole;
  date: string;
  note: string;
  source: string;
}

/** Writes an approved proposal as a realignment and closes the proposal. Only a pending proposal can be approved. */
export async function approveProposal(env: Env, id: string, change: ApprovedChange, userId: string, W: Watch = KE_WATCH): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  await ensureElectionWatchTables(env, W);
  const row = await first<{ status: string }>(env.DB, `SELECT status FROM ${W.t.proposals} WHERE id = ?`, [id]);
  if (!row) return { ok: false, status: 404, error: "Not found" };
  if (row.status !== "pending") return { ok: false, status: 409, error: "This proposal has already been decided" };
  const now = nowIso();
  const data = {
    date: change.date,
    candidate: change.candidate,
    ticket: change.ticket,
    role: change.ticket ? change.role : "backer",
    note: change.note,
    source: change.source,
  };
  await run(env.DB, `INSERT INTO ${W.t.content} (kind, id, data, updated_at) VALUES ('realignment', ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, [`${change.date}-${change.candidate}`, JSON.stringify(data), now]);
  await run(env.DB, `UPDATE ${W.t.proposals} SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?`, [now, userId, id]);
  return { ok: true };
}

export async function rejectProposal(env: Env, id: string, userId: string, W: Watch = KE_WATCH): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  await ensureElectionWatchTables(env, W);
  const row = await first<{ status: string }>(env.DB, `SELECT status FROM ${W.t.proposals} WHERE id = ?`, [id]);
  if (!row) return { ok: false, status: 404, error: "Not found" };
  if (row.status !== "pending") return { ok: false, status: 409, error: "This proposal has already been decided" };
  await run(env.DB, `UPDATE ${W.t.proposals} SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?`, [nowIso(), userId, id]);
  return { ok: true };
}

export async function pendingProposals(env: Env, W: Watch = KE_WATCH) {
  await ensureElectionWatchTables(env, W);
  const rows = await all<{ id: string; data: string; created_at: string }>(env.DB, `SELECT id, data, created_at FROM ${W.t.proposals} WHERE status = 'pending' ORDER BY created_at DESC LIMIT 60`);
  return rows.flatMap((r) => {
    try {
      return [{ id: r.id, created_at: r.created_at, ...(JSON.parse(r.data) as ProposalData) }];
    } catch {
      return [];
    }
  });
}
