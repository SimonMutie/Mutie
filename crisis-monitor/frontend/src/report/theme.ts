import type { Tone } from "./model";

/** Shared look for the Word and PDF reports: the template's navy and blue, with clearer ratings and a serif/sans pairing. */
export const COLORS = {
  navy: "17365D",
  blue: "2F75B5",
  tint: "EAF2F8",
  zebra: "F7F9FB",
  rule: "D0D7E2",
  text: "1F2933",
  muted: "667085",
  white: "FFFFFF",
};

export const TONE: Record<Tone, { fg: string; bg: string; edge: string }> = {
  good: { fg: "1E6B45", bg: "E3F4EA", edge: "2E9E6B" },
  watch: { fg: "8A5A00", bg: "FFF3CD", edge: "D9A21B" },
  high: { fg: "B54708", bg: "FDE7D6", edge: "E8742A" },
  bad: { fg: "B42318", bg: "FDE3E1", edge: "D92D20" },
  none: { fg: "475467", bg: "EEF1F5", edge: "98A2B3" },
};

export const FONT = { head: "Cambria", body: "Calibri", symbol: "Segoe UI Symbol" };

export const URL_RE = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:])/g;

/** Splits text into plain and link pieces. */
export function pieces(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0].length > 60 ? m[0].slice(0, 57) + "…" : m[0], url: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
