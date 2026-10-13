/**
 * Election and transition events for the Kenya and South Sudan timelines.
 *
 * Detection only proposes. A headline that matches an event kind becomes a
 * `proposed` row; a reviewer sets its date and approves it, and only approved
 * rows with a date appear on the public chart. Nothing is published on its own.
 */
import { all, first, run } from "../db";
import { newId } from "../ids";
import { locateText } from "./africaGeo";
import type { Env } from "../bindings";

export const TIMELINE_COUNTRIES = ["KE", "SS"] as const;
export type TimelineCountry = (typeof TIMELINE_COUNTRIES)[number];

export const EVENT_KINDS: { kind: string; rx: RegExp }[] = [
  { kind: "primaries", rx: /\b(party primar\w+|primary elections?|party nominations?)\b/i },
  { kind: "resignation", rx: /^(?=.*\b(?:resign\w*|steps? down)\b)(?=.*\b(?:minister|governor|commissioner|official|chair\w*|IEBC|NEC)\b).*/i },
  { kind: "electoral_body", rx: /\b(IEBC|National Elections Commission|NEC)\b[^.!?]{0,80}\b(gazett\w*|notice|timetable|deadline|voter registration|voter roll|postpon\w*|election date)\b/i },
  { kind: "nomination", rx: /\b(nominat\w*|candidate (?:filing|registration)|(?:files?|filed) (?:for|as) (?:president|presidential|governor)|declares? (?:his|her) (?:candidacy|bid))\b/i },
  { kind: "petition", rx: /\b(election petition|run-?off|election court)\b/i },
  { kind: "by_election", rx: /\bby-?election\b/i },
  { kind: "transition", rx: /\b(coup|mutiny|sworn in|swearing-in|cabinet reshuffle|new (?:prime minister|cabinet)|transitional government)\b/i },
];

export async function ensureElectionTable(env: Env): Promise<void> {
  await run(
    env.DB,
    `CREATE TABLE IF NOT EXISTS election_proposals (
      id TEXT PRIMARY KEY,
      country_code TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      source_url TEXT NOT NULL UNIQUE,
      source_domain TEXT,
      published_at TEXT,
      status TEXT NOT NULL DEFAULT 'proposed',
      date TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT
    )`
  );
}

export interface ElectionCandidate {
  url: string;
  domain: string;
  title: string | null;
  publishedAt: string | null;
}

/** Matches one headline. Returns null unless it is about Kenya or South Sudan
 *  and describes a recognised election or transition event. */
export function detectElectionEvent(title: string): { countryCode: TimelineCountry; kind: string } | null {
  const loc = locateText(title)?.countryCode ?? null;
  const countryCode: TimelineCountry | null = loc === "KE" || loc === "SS" ? loc : /\bIEBC\b/.test(title) ? "KE" : /\bNEC\b|\bKiir\b/.test(title) ? "SS" : null;
  if (!countryCode) return null;
  const hit = EVENT_KINDS.find((k) => k.rx.test(title));
  return hit ? { countryCode, kind: hit.kind } : null;
}

/** Adds a proposal for each new matching headline. Cheap: no model, no article download. */
export async function proposeElectionEntries(env: Env, candidates: ElectionCandidate[]): Promise<number> {
  await ensureElectionTable(env);
  let added = 0;
  for (const c of candidates) {
    if (!c.title) continue;
    const hit = detectElectionEvent(c.title);
    if (!hit) continue;
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO election_proposals (id, country_code, kind, title, source_url, source_domain, published_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`
    )
      .bind(newId(), hit.countryCode, hit.kind, c.title, c.url, c.domain, c.publishedAt, new Date().toISOString())
      .run();
    if (res.meta?.changes) added++;
  }
  return added;
}

export interface ElectionEntry {
  id: string;
  countryCode: string;
  kind: string;
  title: string;
  date: string;
  detail: string | null;
  sourceUrl: string;
  sourceDomain: string | null;
}

/** Approved entries with a date: the only ones shown publicly. */
export async function publishedEntries(env: Env, country: string): Promise<ElectionEntry[]> {
  await ensureElectionTable(env);
  const rows = await all<{ id: string; country_code: string; kind: string; title: string; date: string; detail: string | null; source_url: string; source_domain: string | null }>(
    env.DB,
    `SELECT id, country_code, kind, title, date, detail, source_url, source_domain FROM election_proposals WHERE status = 'approved' AND date IS NOT NULL AND country_code = ? ORDER BY date`,
    [country]
  );
  return rows.map((r) => ({ id: r.id, countryCode: r.country_code, kind: r.kind, title: r.title, date: r.date, detail: r.detail, sourceUrl: r.source_url, sourceDomain: r.source_domain }));
}

export async function proposalById(env: Env, id: string) {
  return first<{ id: string }>(env.DB, `SELECT id FROM election_proposals WHERE id = ?`, [id]);
}
