/**
 * Humanitarian and political events: what the escalation pipeline reads but does not count as armed conflict.
 *
 * When the coder rejects an article as humanitarian-only, political-only, or unrest without an armed actor, it may
 * also record one non-armed event from it (a displacement wave, an outbreak, a protest crackdown, a government
 * falling). These are kept apart from escalation: they never raise an incident's level or set off an alert. They
 * get their own severity, S1 to S3, from fixed rules on the event's type and the numbers the article states.
 */
export type SituationCategory = "humanitarian" | "political";

export const SITUATION_TYPES: { id: string; category: SituationCategory; label: string; definition: string }[] = [
  { id: "displacement", category: "humanitarian", label: "Displacement", definition: "People newly forced from their homes or crossing a border as refugees, with a figure or a named place." },
  { id: "disease_outbreak", category: "humanitarian", label: "Disease outbreak", definition: "A declared or spreading outbreak (cholera, measles, mpox, Ebola, Marburg, dengue and so on) with cases or deaths reported." },
  { id: "food_crisis", category: "humanitarian", label: "Hunger or famine", definition: "Famine declared, or famine or emergency hunger conditions reported for a named area." },
  { id: "disaster", category: "humanitarian", label: "Flood, drought or disaster", definition: "A flood, landslide, drought, storm, earthquake or similar disaster with people killed, affected or displaced." },
  { id: "aid_access", category: "humanitarian", label: "Aid blocked or suspended", definition: "Aid operations suspended, convoys blocked, aid workers expelled, or crossings closed to relief." },
  { id: "protest_or_unrest", category: "political", label: "Protest or unrest", definition: "Mass protests, riots or strikes, or a security-force crackdown on them, with no organised armed group involved." },
  { id: "election", category: "political", label: "Election", definition: "Voting, results, a disputed count, or a candidate barred or arrested, in a national or major regional election." },
  { id: "government_change", category: "political", label: "Change of government", definition: "A head of state or government resigns, is dismissed or replaced, a cabinet falls, or a transition is announced (not by force: that is a coup)." },
  { id: "rights_restriction", category: "political", label: "Crackdown or shutdown", definition: "An internet shutdown, media ban, party ban, mass arrest of opponents, or a state of emergency not tied to armed violence." },
  { id: "diplomatic_rupture", category: "political", label: "Diplomatic rupture or sanctions", definition: "Ambassadors expelled or recalled, relations cut, a border closed, or sanctions imposed." },
  { id: "peace_process", category: "political", label: "Peace talks or deal", definition: "Peace talks opened or collapsed, or a ceasefire or peace deal signed." },
];
export const SITUATION_TYPE_IDS = SITUATION_TYPES.map((t) => t.id);
export const SITUATION_BY_ID = Object.fromEntries(SITUATION_TYPES.map((t) => [t.id, t]));
/** Rejection reasons whose articles may carry a non-armed event. */
export const SITUATION_REASONS = new Set(["humanitarian_only", "diplomatic_or_political_only", "crime_or_unrest_without_armed_actor"]);

export type SituationSeverity = 1 | 2 | 3;

/**
 * S3: 25 or more deaths, 100,000 or more people affected, or a change of government.
 * S2: any deaths, 10,000 or more affected, or a type that matters on its own (unrest, an election, a crackdown,
 *     an outbreak, aid blocked, a diplomatic rupture, a peace deal or talks).
 * S1: anything else.
 */
export function situationSeverity(type: string, deaths: number | null, affected: number | null): SituationSeverity {
  if ((deaths ?? 0) >= 25 || (affected ?? 0) >= 100_000 || type === "government_change") return 3;
  if ((deaths ?? 0) >= 1 || (affected ?? 0) >= 10_000) return 2;
  if (["protest_or_unrest", "election", "rights_restriction", "disease_outbreak", "aid_access", "diplomatic_rupture", "peace_process"].includes(type)) return 2;
  return 1;
}

export function situationPromptText(): string {
  return SITUATION_TYPES.map((t) => `- ${t.id} (${t.category}): ${t.definition}`).join("\n");
}

export interface SituationRow {
  id: string;
  articleId: string;
  url: string;
  domain: string;
  title: string;
  type: string;
  category: SituationCategory;
  severity: SituationSeverity;
  countryCode: string;
  countryName: string;
  place: string | null;
  lat: number;
  lon: number;
  precision: string;
  eventDate: string;
  deaths: number | null;
  affected: number | null;
  summary: string;
  quote: string;
  confidence: string;
}

export interface SituationEvent {
  id: string;
  type: string;
  typeLabel: string;
  category: SituationCategory;
  severity: SituationSeverity;
  countryCode: string;
  countryName: string;
  place: string | null;
  lat: number;
  lon: number;
  precision: string;
  firstDate: string;
  lastDate: string;
  deaths: number | null;
  affected: number | null;
  summary: string;
  quote: string;
  /** Different outlets reporting it. Telegram counts as one. */
  outlets: number;
  confidence: "confirmed" | "single source";
  sources: { title: string; url: string; domain: string; date: string }[];
}

const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
const placeKey = (r: SituationRow) => (r.place ?? "").toLowerCase().replace(/[^a-z؀-ۿ]+/g, "") || `@${r.lat.toFixed(0)},${r.lon.toFixed(0)}`;

/** Folds reports of the same event (same type, country and place, within three days) into one, with its sources. */
export function groupSituationRows(rows: SituationRow[]): SituationEvent[] {
  const sorted = [...rows].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const groups: SituationRow[][] = [];
  for (const r of sorted) {
    const g = groups.find((g) => {
      const last = g[g.length - 1];
      return last.type === r.type && last.countryCode === r.countryCode && placeKey(last) === placeKey(r) && dayMs(r.eventDate) - dayMs(last.eventDate) <= 3 * 86_400_000;
    });
    if (g) g.push(r);
    else groups.push([r]);
  }
  return groups
    .map((g) => {
      const lead = [...g].sort((a, b) => b.severity - a.severity || (b.confidence === "high" ? 1 : 0) - (a.confidence === "high" ? 1 : 0))[0];
      const outlets = new Set(g.map((r) => r.domain.toLowerCase())).size;
      const max = (f: (r: SituationRow) => number | null) => {
        const v = g.map(f).filter((x): x is number => x !== null);
        return v.length ? Math.max(...v) : null;
      };
      const deaths = max((r) => r.deaths);
      const affected = max((r) => r.affected);
      const seen = new Set<string>();
      return {
        id: lead.id,
        type: lead.type,
        typeLabel: SITUATION_BY_ID[lead.type]?.label ?? lead.type,
        category: lead.category,
        severity: situationSeverity(lead.type, deaths, affected),
        countryCode: lead.countryCode,
        countryName: lead.countryName,
        place: lead.place,
        lat: lead.lat,
        lon: lead.lon,
        precision: lead.precision,
        firstDate: g[0].eventDate,
        lastDate: g[g.length - 1].eventDate,
        deaths,
        affected,
        summary: lead.summary,
        quote: lead.quote,
        outlets,
        confidence: outlets >= 2 && g.some((r) => r.confidence !== "low") ? ("confirmed" as const) : ("single source" as const),
        sources: g
          .filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
          .map((r) => ({ title: r.title, url: r.url, domain: r.domain, date: r.eventDate })),
      };
    })
    .sort((a, b) => b.severity - a.severity || b.lastDate.localeCompare(a.lastDate));
}
