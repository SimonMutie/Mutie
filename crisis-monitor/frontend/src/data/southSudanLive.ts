import { createContext } from "react";
import type { EwContent } from "../api";
import { BENCHMARKS, CANDIDATES_BASE, HOLDERS, TIMELINE, type Benchmark, type Holder, type Milestone } from "./southSudanElection";
import { overlay } from "./electionLive";

/**
 * South Sudan's live content: the static record overlaid with what analysts
 * have saved. A saved row replaces the static one with the same id, a new id
 * adds one, and {deleted: true} removes one. Same mechanism as Kenya.
 */
export interface SsCandidate {
  id: string;
  name: string;
  party?: string;
  standing: string;
  date: string;
  note?: string;
  source?: { label: string; url: string };
}

export interface SsLive {
  offices: Holder[];
  benchmarks: Benchmark[];
  timeline: Milestone[];
  candidates: SsCandidate[];
}

export function mergeSsLive(content: EwContent | null): SsLive {
  const offices = overlay<Holder>(HOLDERS, (h) => h.id, content?.office, (d, id, prev) => ({ ...(prev ?? ({} as Holder)), ...(d as unknown as Holder), id }));
  const benchmarks = overlay<Benchmark>(BENCHMARKS, (b) => b.id, content?.benchmark, (d, id, prev) => ({ ...(prev ?? ({} as Benchmark)), ...(d as unknown as Benchmark), id }));
  const timeline = overlay<Milestone>(TIMELINE, (m) => m.id, content?.milestone, (d, id, prev) => ({ ...(prev ?? ({} as Milestone)), ...(d as unknown as Milestone), id })).sort((a, b) => a.date.localeCompare(b.date));
  const candidates = overlay<SsCandidate>(CANDIDATES_BASE, (c) => c.id, content?.candidate, (d, id, prev) => ({ ...(prev ?? ({} as SsCandidate)), ...(d as unknown as SsCandidate), id }));
  return { offices, benchmarks, timeline, candidates };
}

export const ssStatic = mergeSsLive(null);
export const SsDataCtx = createContext<SsLive>(ssStatic);
