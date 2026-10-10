import type { Reliability, Ownership } from "./sourceRatings";
import type { SourceKind } from "../lib/sourceRegister";
export const EXPANSION_VERSION = 1;
export type ExpansionRow = [country: string, name: string, url: string, kind: SourceKind, reliability: Reliability, ownership: Ownership, orientation: string | null, note: string | null];
export const EXPANSION: ExpansionRow[] = [];
export const RERATED: [string, Reliability, Ownership, string | null, string | null][] = [];
