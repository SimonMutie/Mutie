/**
 * Watch zones: standing warning markers over the conflict theatres of Africa and the Middle East, each with the
 * latest headlines and Telegram posts that name it, and the Lens's own escalation incidents inside it.
 *
 * Adapted from MIT-licensed open-source code (see THIRD_PARTY_NOTICES.md): the idea of a hand-kept list of
 * zones with an editorial severity, and its whole-word headline matcher. Kept to Africa and the Middle East, with
 * a few Africa zones added, and with headlines drawn from the feeds the Lens already reads.
 *
 * A zone's severity is an Afrilens editorial rating of the standing situation, not a live measurement, and the
 * map says so. It is a different thing from an escalation alert, which the Lens raises only when a major event
 * has happened in the past two days and the evidence for it has been read.
 */
export type ZoneSeverity = "war" | "high" | "elevated";

export interface WatchZone {
  id: string;
  label: string;
  severity: ZoneSeverity;
  lat: number;
  lng: number;
  description: string;
  /** Every word of one of these has to appear, as a whole word, for a headline to count as being about the zone. */
  queries: string[];
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export const WATCH_ZONES: WatchZone[] = [
  { id: "sudan", label: "SUDAN CIVIL WAR", severity: "war", lat: 15.0, lng: 30.0, description: "War between the Sudanese Armed Forces and the Rapid Support Forces across Darfur, Kordofan and the Nile states.", queries: ["sudan", "rsf", "el fasher", "darfur", "kordofan", "khartoum"], bounds: { minLat: 8.5, maxLat: 22.5, minLng: 21.5, maxLng: 38.6 } },
  { id: "gaza", label: "GAZA", severity: "war", lat: 31.4, lng: 34.4, description: "Military operations and humanitarian crisis in the Gaza Strip.", queries: ["gaza"], bounds: { minLat: 31.2, maxLat: 31.6, minLng: 34.2, maxLng: 34.6 } },
  { id: "drc", label: "EASTERN DRC", severity: "war", lat: -1.0, lng: 28.5, description: "M23/AFC offensive, ADF attacks and militia violence in North and South Kivu and Ituri.", queries: ["m23", "congo goma", "congo kivu", "congo ituri", "congo adf", "drc rebel", "congo rebel"], bounds: { minLat: -5, maxLat: 3.5, minLng: 26, maxLng: 31.5 } },
  { id: "yemen", label: "YEMEN", severity: "war", lat: 15.5, lng: 46.0, description: "Houthi operations, coalition and Western strikes, and the government–Houthi front lines.", queries: ["yemen", "houthi", "houthis", "sanaa"], bounds: { minLat: 12, maxLat: 19, minLng: 42, maxLng: 54 } },
  { id: "red-sea", label: "RED SEA THREAT", severity: "high", lat: 16.0, lng: 40.0, description: "Missile, drone and boarding threats to shipping in the Red Sea, Bab al-Mandab and Gulf of Aden.", queries: ["red sea", "bab al-mandab", "gulf of aden", "houthi ship", "houthis ship", "vessel attack"], bounds: { minLat: 11, maxLat: 28, minLng: 32.5, maxLng: 51 } },
  { id: "lebanon", label: "LEBANON", severity: "high", lat: 33.4, lng: 35.5, description: "Cross-border strikes and operations in southern Lebanon.", queries: ["lebanon", "hezbollah"], bounds: { minLat: 33, maxLat: 34.7, minLng: 35, maxLng: 36.7 } },
  { id: "syria", label: "SYRIA", severity: "high", lat: 35.0, lng: 38.5, description: "Insurgency, sectarian violence and foreign strikes after the change of government.", queries: ["syria", "syrian"], bounds: { minLat: 32.3, maxLat: 37.3, minLng: 35.6, maxLng: 42.4 } },
  { id: "sahel", label: "CENTRAL SAHEL", severity: "high", lat: 14.0, lng: 0.5, description: "JNIM and Islamic State Sahel insurgencies against the juntas of Mali, Burkina Faso and Niger.", queries: ["mali", "burkina", "niger jnim", "sahel", "jnim"], bounds: { minLat: 10, maxLat: 20, minLng: -12, maxLng: 16 } },
  { id: "somalia", label: "SOMALIA", severity: "high", lat: 4.0, lng: 45.5, description: "Al-Shabaab insurgency, Islamic State in Puntland, and the federal–state disputes.", queries: ["somalia", "al-shabaab", "shabaab", "mogadishu", "puntland"], bounds: { minLat: -1.7, maxLat: 12, minLng: 40.9, maxLng: 51.5 } },
  { id: "ethiopia", label: "ETHIOPIA", severity: "high", lat: 11.5, lng: 38.8, description: "Fano insurgency in Amhara, OLA in Oromia, and renewed fighting in and around Tigray.", queries: ["ethiopia", "tigray", "amhara", "fano", "oromia", "tplf"], bounds: { minLat: 3.4, maxLat: 14.9, minLng: 33, maxLng: 48 } },
  { id: "south-sudan", label: "SOUTH SUDAN", severity: "high", lat: 7.5, lng: 30.5, description: "Clashes between government forces and SPLA-IO and allied militias, and spill-over from Sudan.", queries: ["south sudan", "juba", "spla-io"], bounds: { minLat: 3.5, maxLat: 12.2, minLng: 24, maxLng: 35.9 } },
  { id: "nigeria", label: "NORTHERN NIGERIA", severity: "high", lat: 11.5, lng: 9.0, description: "Boko Haram and ISWAP in the north-east, bandit violence in the north-west, farmer–herder violence in the Middle Belt.", queries: ["nigeria", "boko haram", "iswap", "bandits zamfara", "borno"], bounds: { minLat: 7, maxLat: 14, minLng: 3, maxLng: 14.7 } },
  { id: "libya", label: "LIBYA", severity: "elevated", lat: 30.0, lng: 17.0, description: "Rival governments in Tripoli and the east, with militia clashes in the capital.", queries: ["libya", "tripoli libya", "haftar"], bounds: { minLat: 19.5, maxLat: 33.2, minLng: 9.3, maxLng: 25.2 } },
  { id: "mozambique", label: "CABO DELGADO", severity: "elevated", lat: -12.0, lng: 39.8, description: "Islamic State Mozambique insurgency in Cabo Delgado and Niassa.", queries: ["cabo delgado", "mozambique insurgent", "mozambique islamic"], bounds: { minLat: -14.5, maxLat: -10.4, minLng: 37, maxLng: 40.9 } },
  { id: "iraq", label: "IRAQ", severity: "elevated", lat: 33.3, lng: 44.4, description: "Militia activity and residual Islamic State insurgency.", queries: ["iraq", "iraqi"], bounds: { minLat: 29, maxLat: 37.4, minLng: 38.8, maxLng: 48.6 } },
];

/**
 * The zone a headline is about, or null. Every word of one of a zone's queries has to appear as a whole word:
 * a bare substring test let "war" match "warning". Ported from the reference platform's matchZone.
 */
export function matchZone(text: string, zones: WatchZone[] = WATCH_ZONES): WatchZone | null {
  const words = new Set<string>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []) {
    words.add(w);
    if (w.includes("-")) w.split("-").forEach((part) => words.add(part));
    if (w.length > 3 && w.endsWith("s")) words.add(w.slice(0, -1));
  }
  // The more specific zone wins where two match (the Red Sea before Yemen, Gaza before the rest).
  // Zones the admin built from districts or states come first: they are the most specific of all.
  const order = [...zones.filter((z) => z.id.startsWith("custom-")).map((z) => z.id), "red-sea", "gaza", "lebanon", "south-sudan", "mozambique", ...zones.map((z) => z.id)];
  for (const id of order) {
    const zone = zones.find((z) => z.id === id);
    if (!zone) continue;
    if (zone.queries.some((q) => q.toLowerCase().split(" ").every((term) => words.has(term)))) return zone;
  }
  return null;
}

export interface ZoneHeadline {
  title: string;
  url: string;
  source: string;
  published: string | null;
  telegram: boolean;
}

export interface ZoneIncident {
  id: string;
  headline: string;
  level: string;
  place: string;
  lat: number;
  lon: number;
}

export interface WatchZoneView {
  id: string;
  label: string;
  severity: ZoneSeverity;
  lat: number;
  lng: number;
  description: string;
  headlines: ZoneHeadline[];
  headlineCount: number;
  incidents: ZoneIncident[];
  /** Made by an admin from boundary areas (not one of the standing zones). */
  custom?: boolean;
  bounds?: WatchZone["bounds"];
}

/** An admin's changes to the zones (routes/liveLayers.ts, table watch_zone_overrides). */
export interface ZoneEditRow {
  zone_id: string;
  label: string | null;
  severity: string | null;
  description: string | null;
  units: string | null;
  bounds: string | null;
  retired: number | null;
  custom: number | null;
}

/**
 * The zones as they stand: the standing ones with any edits (name, severity, description, extent) and without the
 * retired ones, plus the zones admins made from boundary areas. A made zone's reports are matched by the names of
 * its areas (a district, a state) and its own name.
 */
export function composeZones(rows: ZoneEditRow[]): WatchZone[] {
  const byId = new Map(rows.map((r) => [r.zone_id, r]));
  const parseBounds = (b: string | null) => {
    try {
      return b ? (JSON.parse(b) as WatchZone["bounds"]) : null;
    } catch {
      return null;
    }
  };
  const sev = (v: string | null, d: ZoneSeverity): ZoneSeverity => (v === "war" || v === "high" || v === "elevated" ? v : d);
  const unitNames = (r: ZoneEditRow | undefined) => {
    try {
      return r?.units ? (JSON.parse(r.units) as { name: string }[]).map((u) => u.name.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim()).filter((n) => n.length > 2) : [];
    } catch {
      return [];
    }
  };
  const standing = WATCH_ZONES.filter((z) => !byId.get(z.id)?.retired).map((z) => {
    const r = byId.get(z.id);
    if (!r) return z;
    return { ...z, label: r.label ?? z.label, severity: sev(r.severity, z.severity), description: r.description ?? z.description, bounds: parseBounds(r.bounds) ?? z.bounds, queries: [...z.queries, ...unitNames(r)] };
  });
  const made = rows
    .filter((r) => r.custom && !r.retired)
    .flatMap((r): WatchZone[] => {
      const b = parseBounds(r.bounds);
      if (!b) return [];
      const label = r.label ?? "WATCH ZONE";
      return [
        {
          id: r.zone_id,
          label,
          severity: sev(r.severity, "elevated"),
          lat: (b.minLat + b.maxLat) / 2,
          lng: (b.minLng + b.maxLng) / 2,
          description: r.description ?? "",
          queries: [...new Set([...unitNames(r), label.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim()])].filter(Boolean),
          bounds: b,
        },
      ];
    });
  return [...standing, ...made];
}

const inside = (b: WatchZone["bounds"], lat: number, lon: number) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLng && lon <= b.maxLng;

export function buildZones(
  items: { title: string; text: string; link: string; source: string; published: string | null; telegram: boolean }[],
  incidents: { id: string; headline: string | null; level: string; locationLabel: string | null; countryName: string; lat: number; lon: number }[],
  zones: WatchZone[] = WATCH_ZONES
): WatchZoneView[] {
  const byZone = new Map<string, ZoneHeadline[]>();
  const seen = new Set<string>();
  for (const it of items) {
    const zone = matchZone(`${it.title} ${it.text.slice(0, 400)}`, zones);
    if (!zone) continue;
    const key = it.title.slice(0, 150).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (byZone.get(zone.id) ?? byZone.set(zone.id, []).get(zone.id)!).push({ title: it.title.slice(0, 200), url: it.link, source: it.source, published: it.published, telegram: it.telegram });
  }
  return zones.map((z) => {
    const heads = (byZone.get(z.id) ?? []).sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
    return {
      id: z.id,
      label: z.label,
      severity: z.severity,
      lat: z.lat,
      lng: z.lng,
      description: z.description,
      // The zone's box, which the map uses to cut a sub-national zone out of its country (frontend watchZoneAreas.ts).
      bounds: z.bounds,
      custom: z.id.startsWith("custom-") || undefined,
      headlines: heads.slice(0, 25),
      headlineCount: heads.length,
      incidents: incidents
        .filter((i) => i.headline && inside(z.bounds, i.lat, i.lon))
        .map((i) => ({ id: i.id, headline: i.headline as string, level: i.level, place: i.locationLabel ?? i.countryName, lat: i.lat, lon: i.lon })),
    };
  });
}
