import { createContext } from "react";
import type { EwContent } from "../api";
import { CANDIDATES, POLLS, TIMELINE, type Candidate, type Milestone, type Poll } from "./kenyaElection";
import { CANDIDATE_SEEDS, type CandidateSeed, type Realignment } from "../lib/kenyaSim";

/**
 * The election product is the static data in kenyaElection.ts overlaid with
 * what analysts have saved in the database: a saved row replaces the static
 * one with the same id, a new id adds one, and {deleted: true} removes one.
 * Each candidate's poll shares are always derived from the polls themselves,
 * so adding a poll updates the charts, the candidate cards and the profiles.
 */

export interface SimLive {
  /** Simulator inputs per candidate: strength, mobilisation, backyard and strongholds. */
  seeds: CandidateSeed[];
  realignments: Realignment[];
}

export interface Live {
  polls: Poll[];
  candidates: Candidate[];
  timeline: Milestone[];
  sim: SimLive;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
export const milestoneId = (m: { date: string; title: string }) => `${m.date}-${slug(m.title)}`.slice(0, 60);

type Row = { id: string; data: Record<string, unknown> };
export function overlay<T extends { id?: string }>(base: T[], idOf: (t: T) => string, rows: Row[] | undefined, make: (data: Record<string, unknown>, id: string, prev?: T) => T): T[] {
  const map = new Map(base.map((b) => [idOf(b), b]));
  for (const r of rows ?? []) {
    if (r.data.deleted) map.delete(r.id);
    else map.set(r.id, make(r.data, r.id, map.get(r.id)));
  }
  return [...map.values()];
}

export function mergeLive(content: EwContent | null): Live {
  const polls = overlay<Poll>(POLLS, (p) => p.id, content?.poll, (d, id, prev) => ({ ...(prev ?? ({} as Poll)), ...(d as unknown as Poll), id })).sort((a, b) => a.published.localeCompare(b.published));
  const candidates = overlay<Candidate>(CANDIDATES, (c) => c.id, content?.candidate, (d, id, prev) => ({
    id,
    name: "",
    party: "",
    wiki: "",
    standing: "Declared interest",
    role: "",
    base: "",
    bio: "",
    assets: [],
    risks: [],
    polls: {},
    ...(prev ?? {}),
    ...(d as Partial<Candidate>),
  } as Candidate));
  for (const c of candidates) c.polls = Object.fromEntries(polls.filter((p) => p.shares[c.id] !== undefined).map((p) => [p.id, p.shares[c.id]]));
  const timeline = overlay<Milestone & { id?: string }>(TIMELINE.map((m) => ({ ...m, id: milestoneId(m) })), (m) => m.id ?? milestoneId(m), content?.milestone, (d, id, prev) => ({ ...(prev ?? ({} as Milestone)), ...(d as unknown as Milestone), id }));
  timeline.sort((a, b) => a.date.localeCompare(b.date));
  return { polls, candidates, timeline, sim: mergeSim(content) };
}

/**
 * Simulator inputs. Rows: "candidate-input" (id = candidate, {mobilisation, backyard}),
 * "stronghold" (id = candidate-region, {candidate, region, level 0-2}) and
 * "realignment" (id = date-candidate, {date, candidate, ticket, note, source}).
 */
export function mergeSim(content: EwContent | null): SimLive {
  const seeds: CandidateSeed[] = CANDIDATE_SEEDS.map((s) => ({ ...s, backyard: [...s.backyard], strongholds: { ...s.strongholds } }));
  const byId = new Map(seeds.map((s) => [s.id, s]));
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  for (const r of content?.["candidate-input"] ?? []) {
    const d = r.data as { name?: string; short?: string; mobilisation?: number; backyard?: unknown; deleted?: boolean };
    if (d.deleted) continue;
    let s = byId.get(r.id);
    if (!s) {
      const name = typeof d.name === "string" && d.name ? d.name : r.id;
      s = { id: r.id, name, short: typeof d.short === "string" && d.short ? d.short : name.split(" ").pop() ?? name, mobilisation: 0.4, backyard: [], strongholds: {} };
      seeds.push(s);
      byId.set(r.id, s);
    }
    if (typeof d.mobilisation === "number" && Number.isFinite(d.mobilisation)) s.mobilisation = clamp01(d.mobilisation);
    if (Array.isArray(d.backyard)) s.backyard = d.backyard.map(String).filter((x) => /^\d{3}$/.test(x));
  }

  for (const r of content?.stronghold ?? []) {
    const d = r.data as { candidate?: string; region?: string; level?: number; deleted?: boolean };
    const s = byId.get(String(d.candidate ?? ""));
    if (!s || !d.region) continue;
    if (d.deleted || !d.level) delete s.strongholds[d.region];
    else s.strongholds[d.region] = Math.min(2, Math.max(0, Math.round(Number(d.level))));
  }

  const realignments = overlay<Realignment>([], (x) => x.id, content?.realignment, (d, id) => ({
    id,
    date: String(d.date ?? ""),
    candidate: String(d.candidate ?? ""),
    ticket: d.ticket ? String(d.ticket) : null,
    note: String(d.note ?? ""),
    source: String(d.source ?? ""),
  }))
    .filter((x) => x.date && x.candidate)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { seeds, realignments };
}

export const staticLive: Live = mergeLive(null);
export const ElectionDataCtx = createContext<Live>(staticLive);
