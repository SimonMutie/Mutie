import { createContext } from "react";
import type { EwContent } from "../api";
import { CANDIDATES, POLLS, TIMELINE, type Candidate, type Milestone, type Poll } from "./kenyaElection";

/**
 * The election product is the static data in kenyaElection.ts overlaid with
 * what analysts have saved in the database: a saved row replaces the static
 * one with the same id, a new id adds one, and {deleted: true} removes one.
 * Each candidate's poll shares are always derived from the polls themselves,
 * so adding a poll updates the charts, the candidate cards and the profiles.
 */

export interface Live {
  polls: Poll[];
  candidates: Candidate[];
  timeline: Milestone[];
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
function overlay<T extends { id?: string }>(base: T[], idOf: (t: T) => string, rows: Row[] | undefined, make: (data: Record<string, unknown>, id: string, prev?: T) => T): T[] {
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
  return { polls, candidates, timeline };
}

export const staticLive: Live = mergeLive(null);
export const ElectionDataCtx = createContext<Live>(staticLive);
