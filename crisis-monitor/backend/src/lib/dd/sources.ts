import type { Env } from "../../bindings";
import { nameSimilarity, POSSIBLE, strengthOf, type Strength } from "./match";

/**
 * The open-data checks that sit beside sanctions screening: who holds or
 * held public office (Wikidata), what a company is and who owns it (GLEIF,
 * UK Companies House), and whether a name appears in the ICIJ Offshore
 * Leaks. All are free to use commercially (Wikidata CC0, GLEIF CC0, Companies
 * House open data, Offshore Leaks under the ODbL with attribution).
 *
 * Every check returns a status as well as hits. "unavailable" means the
 * check did not run, which is not the same as "nothing found".
 */

export type CheckState = "ok" | "unavailable" | "not_configured";
export interface Check<T> {
  id: string;
  label: string;
  state: CheckState;
  note?: string;
  hits: T[];
}
export type Kind = "person" | "entity";

const UA = "TheLens-DueDiligence/1.0 (+https://afrilensconsulting.com; contact via site)";
const TIMEOUT_MS = 15_000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
  const body = res.ok || res.status === 404 ? ((await res.json().catch(() => null)) as T | null) : null;
  return { status: res.status, body };
}
const fail = (id: string, label: string, err: unknown): Check<never> => ({ id, label, state: "unavailable", note: err instanceof Error ? err.message : String(err), hits: [] });
const best = (query: string, candidates: string[], kind: Kind) => Math.max(0, ...candidates.map((c) => nameSimilarity(query, c, kind)));

// ── Wikidata: public office and state ownership ──────────────────────────

export interface WikidataHit {
  qid: string;
  url: string;
  label: string;
  description: string | null;
  score: number;
  strength: Strength;
  isHuman: boolean;
  positions: { label: string; from: string | null; to: string | null; current: boolean }[];
  countries: string[];
  /** For organisations: what it is, and its parent or owner. */
  facts: string[];
  /** Descriptive record of an organisation, where Wikidata holds one. */
  profile?: { inception: string | null; headquarters: string | null; employees: number | null; industry: string[]; leaders: string[]; website: string | null; founders: string[] };
  /** Descriptive record of a person: public-biography facts only (birth year, never address or family). */
  person?: { born: string | null; died: string | null; occupations: string[]; education: { label: string; from: string | null; to: string | null }[]; employers: { label: string; from: string | null; to: string | null }[]; parties: string[]; memberships: string[]; awards: string[] };
}

type Claim = { mainsnak?: { datavalue?: { value?: unknown } }; qualifiers?: Record<string, { datavalue?: { value?: { time?: string } } }[]> };
interface WdEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, Claim[]>;
}

const qidOf = (c: Claim): string | null => {
  const v = c.mainsnak?.datavalue?.value as { id?: string } | undefined;
  return v?.id ?? null;
};
const year = (c: Claim, prop: string): string | null => {
  const t = c.qualifiers?.[prop]?.[0]?.datavalue?.value?.time;
  return t ? t.replace(/^\+/, "").slice(0, 4) : null;
};

export async function checkWikidata(name: string, kind: Kind): Promise<Check<WikidataHit>> {
  const id = "wikidata";
  const label = "Public office and state ownership (Wikidata)";
  try {
    const search = await getJson<{ search?: { id: string }[] }>(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=8&format=json&origin=*`);
    if (search.status !== 200 || !search.body) return { id, label, state: "unavailable", note: `Wikidata answered ${search.status}`, hits: [] };
    const ids = (search.body.search ?? []).map((s) => s.id);
    if (!ids.length) return { id, label, state: "ok", hits: [] };
    const got = await getJson<{ entities?: Record<string, WdEntity> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=labels|descriptions|aliases|claims&languages=en|fr|pt|ar&format=json&origin=*`);
    const entities = Object.values(got.body?.entities ?? {});
    const wanted = new Set<string>();
    const picked = entities
      .map((e) => {
        const names = [...Object.values(e.labels ?? {}).map((l) => l.value), ...Object.values(e.aliases ?? {}).flat().map((a) => a.value)];
        const score = best(name, names, kind);
        const human = (e.claims?.P31 ?? []).some((c) => qidOf(c) === "Q5");
        return { e, score, human };
      })
      .filter((x) => x.score >= POSSIBLE && (kind === "person" ? x.human : !x.human));
    for (const { e } of picked) for (const prop of ["P39", "P27", "P17", "P31", "P749", "P127", "P159", "P452", "P169", "P488", "P112", "P106", "P69", "P108", "P102", "P463", "P166"]) for (const c of e.claims?.[prop] ?? []) { const q = qidOf(c); if (q) wanted.add(q); }
    const labels = new Map<string, string>();
    const list = [...wanted].slice(0, 50);
    for (let i = 0; i < list.length; i += 50) {
      const r = await getJson<{ entities?: Record<string, WdEntity> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${list.slice(i, i + 50).join("|")}&props=labels&languages=en&format=json&origin=*`);
      for (const [q, ent] of Object.entries(r.body?.entities ?? {})) if (ent.labels?.en) labels.set(q, ent.labels.en.value);
    }
    const hits: WikidataHit[] = picked
      .map(({ e, score, human }) => {
        const positions = (e.claims?.P39 ?? []).map((c) => ({ label: labels.get(qidOf(c) ?? "") ?? "public office", from: year(c, "P580"), to: year(c, "P582"), current: !year(c, "P582") })).filter((p) => p.label);
        const countries = [...new Set([...(e.claims?.P27 ?? []), ...(e.claims?.P17 ?? [])].map((c) => labels.get(qidOf(c) ?? "")).filter((x): x is string => !!x))];
        const facts = human
          ? []
          : [
              ...(e.claims?.P31 ?? []).map((c) => labels.get(qidOf(c) ?? "")).filter((x): x is string => !!x).map((x) => `Type: ${x}`),
              ...(e.claims?.P749 ?? []).map((c) => labels.get(qidOf(c) ?? "")).filter((x): x is string => !!x).map((x) => `Parent organisation: ${x}`),
              ...(e.claims?.P127 ?? []).map((c) => labels.get(qidOf(c) ?? "")).filter((x): x is string => !!x).map((x) => `Owned by: ${x}`),
            ];
        const lab = (prop: string) => (e.claims?.[prop] ?? []).map((c) => labels.get(qidOf(c) ?? "")).filter((x): x is string => !!x);
        const inc = (e.claims?.P571 ?? [])[0]?.mainsnak?.datavalue?.value as { time?: string } | undefined;
        const emp = (e.claims?.P1128 ?? [])[0]?.mainsnak?.datavalue?.value as { amount?: string } | undefined;
        const site = (e.claims?.P856 ?? [])[0]?.mainsnak?.datavalue?.value;
        const born = (e.claims?.P569 ?? [])[0]?.mainsnak?.datavalue?.value as { time?: string } | undefined;
        const died = (e.claims?.P570 ?? [])[0]?.mainsnak?.datavalue?.value as { time?: string } | undefined;
        const dated = (prop: string) => (e.claims?.[prop] ?? []).map((c) => ({ label: labels.get(qidOf(c) ?? "") ?? "", from: year(c, "P580"), to: year(c, "P582") })).filter((x) => x.label).slice(0, 6);
        const person = human
          ? {
              born: born?.time ? born.time.replace(/^\+/, "").slice(0, 4) : null,
              died: died?.time ? died.time.replace(/^\+/, "").slice(0, 4) : null,
              occupations: lab("P106").slice(0, 5),
              education: dated("P69"),
              employers: dated("P108"),
              parties: lab("P102").slice(0, 3),
              memberships: lab("P463").slice(0, 5),
              awards: lab("P166").slice(0, 4),
            }
          : undefined;
        const profile = human
          ? undefined
          : {
              inception: inc?.time ? inc.time.replace(/^\+/, "").slice(0, 10).replace(/-00/g, "") : null,
              headquarters: lab("P159")[0] ?? null,
              employees: emp?.amount ? Math.round(Number(emp.amount.replace(/^\+/, ""))) || null : null,
              industry: lab("P452").slice(0, 4),
              leaders: [...lab("P169").map((n) => `${n} (chief executive)`), ...lab("P488").map((n) => `${n} (chair)`)].slice(0, 4),
              website: typeof site === "string" ? site : null,
              founders: lab("P112").slice(0, 3),
            };
        return { qid: e.id, url: `https://www.wikidata.org/wiki/${e.id}`, label: e.labels?.en?.value ?? e.id, description: e.descriptions?.en?.value ?? null, score, strength: strengthOf(score) ?? ("possible" as Strength), isHuman: human, positions, countries, facts, profile, person };
      })
      // For a person only those who hold or held office matter here; an organisation is kept if the entry says anything about ownership.
      .filter((h) => (kind === "person" ? h.positions.length > 0 || !!(h.person && (h.person.born || h.person.occupations.length || h.person.education.length || h.person.employers.length || h.person.parties.length)) : h.facts.length > 0 || !!(h.profile && (h.profile.inception || h.profile.headquarters || h.profile.employees || h.profile.industry.length || h.profile.leaders.length))))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return { id, label, state: "ok", hits };
  } catch (err) {
    return fail(id, label, err);
  }
}

// ── GLEIF: legal entity records and parents ──────────────────────────────

export interface GleifHit {
  lei: string;
  url: string;
  name: string;
  score: number;
  strength: Strength;
  status: string | null;
  jurisdiction: string | null;
  country: string | null;
  category: string | null;
  registeredAs: string | null;
  directParent: string | null;
  ultimateParent: string | null;
  address: string | null;
  incorporated: string | null;
  legalForm: string | null;
}

interface GleifRecord {
  id: string;
  attributes?: { lei?: string; entity?: { legalName?: { name?: string }; status?: string; jurisdiction?: string; category?: string; registeredAs?: string; legalAddress?: { country?: string; city?: string; addressLines?: string[]; postalCode?: string }; creationDate?: string; legalForm?: { id?: string; other?: string } } };
}

export async function checkGleif(name: string): Promise<Check<GleifHit>> {
  const id = "gleif";
  const label = "Legal entity records and parents (GLEIF)";
  try {
    const base = "https://api.gleif.org/api/v1";
    const fuzzy = await getJson<{ data?: { attributes?: { value?: string }; relationships?: { "lei-records"?: { data?: { id?: string } } } }[] }>(`${base}/fuzzycompletions?field=entity.legalName&q=${encodeURIComponent(name)}`, { Accept: "application/vnd.api+json" });
    if (fuzzy.status !== 200) return { id, label, state: "unavailable", note: `GLEIF answered ${fuzzy.status}`, hits: [] };
    const leis = [...new Set((fuzzy.body?.data ?? []).map((d) => d.relationships?.["lei-records"]?.data?.id).filter((x): x is string => !!x))].slice(0, 10);
    if (!leis.length) return { id, label, state: "ok", hits: [] };
    const recs = await getJson<{ data?: GleifRecord[] }>(`${base}/lei-records?filter[lei]=${leis.join(",")}&page[size]=10`, { Accept: "application/vnd.api+json" });
    const scored = (recs.body?.data ?? [])
      .map((r) => ({ r, score: nameSimilarity(name, r.attributes?.entity?.legalName?.name ?? "", "entity") }))
      .filter((x) => x.score >= POSSIBLE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const parentName = async (lei: string, which: "direct-parent" | "ultimate-parent"): Promise<string | null> => {
      const p = await getJson<{ data?: GleifRecord }>(`${base}/lei-records/${lei}/${which}`, { Accept: "application/vnd.api+json" });
      return p.status === 200 ? (p.body?.data?.attributes?.entity?.legalName?.name ?? null) : null;
    };
    const hits: GleifHit[] = [];
    for (const { r, score } of scored) {
      const lei = r.attributes?.lei ?? r.id;
      const e = r.attributes?.entity;
      const [directParent, ultimateParent] = await Promise.all([parentName(lei, "direct-parent").catch(() => null), parentName(lei, "ultimate-parent").catch(() => null)]);
      hits.push({ lei, url: `https://search.gleif.org/#/record/${lei}`, name: e?.legalName?.name ?? lei, score, strength: strengthOf(score) ?? "possible", status: e?.status ?? null, jurisdiction: e?.jurisdiction ?? null, country: e?.legalAddress?.country ?? null, category: e?.category ?? null, registeredAs: e?.registeredAs ?? null, directParent, ultimateParent, address: [...(e?.legalAddress?.addressLines ?? []), e?.legalAddress?.city, e?.legalAddress?.postalCode, e?.legalAddress?.country].filter(Boolean).join(", ") || null, incorporated: e?.creationDate ? e.creationDate.slice(0, 10) : null, legalForm: e?.legalForm?.other ?? e?.legalForm?.id ?? null });
    }
    return { id, label, state: "ok", hits };
  } catch (err) {
    return fail(id, label, err);
  }
}

// ── UK Companies House (free API key) ────────────────────────────────────

export interface CompaniesHouseHit {
  kind: "company" | "officer";
  number: string | null;
  url: string;
  name: string;
  score: number;
  strength: Strength;
  status: string | null;
  incorporated: string | null;
  companyType: string | null;
  /** Officers and people with significant control of a company (names and roles only). */
  people: { name: string; role: string; resigned: boolean }[];
  /** For an officer: how many appointments the register lists. */
  appointments: number | null;
  address?: string | null;
  sic?: string[];
}

export async function checkCompaniesHouse(env: Env, name: string, kind: Kind): Promise<Check<CompaniesHouseHit>> {
  const id = "companies_house";
  const label = "UK company register (Companies House)";
  if (!env.COMPANIES_HOUSE_API_KEY) return { id, label, state: "not_configured", note: "Add a free Companies House API key to include the UK register: set COMPANIES_HOUSE_API_KEY.", hits: [] };
  const auth = { Authorization: `Basic ${btoa(`${env.COMPANIES_HOUSE_API_KEY}:`)}` };
  const base = "https://api.company-information.service.gov.uk";
  try {
    if (kind === "entity") {
      const s = await getJson<{ items?: { company_number: string; title: string; company_status?: string; date_of_creation?: string; company_type?: string }[] }>(`${base}/search/companies?q=${encodeURIComponent(name)}&items_per_page=8`, auth);
      if (s.status !== 200) return { id, label, state: "unavailable", note: `Companies House answered ${s.status}`, hits: [] };
      const top = (s.body?.items ?? [])
        .map((c) => ({ c, score: nameSimilarity(name, c.title, "entity") }))
        .filter((x) => x.score >= POSSIBLE)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const hits: CompaniesHouseHit[] = [];
      for (const { c, score } of top) {
        const [prof, off, psc] = await Promise.all([
          getJson<{ registered_office_address?: Record<string, string>; sic_codes?: string[] }>(`${base}/company/${c.company_number}`, auth).catch(() => null),
          getJson<{ items?: { name: string; officer_role?: string; resigned_on?: string }[] }>(`${base}/company/${c.company_number}/officers?items_per_page=30`, auth).catch(() => null),
          getJson<{ items?: { name: string; kind?: string; ceased_on?: string }[] }>(`${base}/company/${c.company_number}/persons-with-significant-control?items_per_page=30`, auth).catch(() => null),
        ]);
        const people = [
          ...(off?.body?.items ?? []).map((o) => ({ name: o.name, role: (o.officer_role ?? "officer").replace(/-/g, " "), resigned: !!o.resigned_on })),
          ...(psc?.body?.items ?? []).map((p) => ({ name: p.name, role: "person with significant control", resigned: !!p.ceased_on })),
        ].slice(0, 40);
        hits.push({ kind: "company", number: c.company_number, url: `https://find-and-update.company-information.service.gov.uk/company/${c.company_number}`, name: c.title, score, strength: strengthOf(score) ?? "possible", status: c.company_status ?? null, incorporated: c.date_of_creation ?? null, companyType: c.company_type ?? null, people, appointments: null, address: prof?.body?.registered_office_address ? Object.values(prof.body.registered_office_address).filter(Boolean).join(", ") : null, sic: prof?.body?.sic_codes ?? [] });
      }
      return { id, label, state: "ok", hits };
    }
    // A person: only the public register's own listing of appointments, never addresses or birth dates.
    const s = await getJson<{ items?: { title: string; appointment_count?: number; links?: { self?: string } }[] }>(`${base}/search/officers?q=${encodeURIComponent(name)}&items_per_page=8`, auth);
    if (s.status !== 200) return { id, label, state: "unavailable", note: `Companies House answered ${s.status}`, hits: [] };
    const hits: CompaniesHouseHit[] = (s.body?.items ?? [])
      .map((o) => ({ o, score: nameSimilarity(name, o.title, "person") }))
      .filter((x) => x.score >= POSSIBLE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ o, score }) => ({ kind: "officer" as const, number: null, url: o.links?.self ? `https://find-and-update.company-information.service.gov.uk${o.links.self}` : "https://find-and-update.company-information.service.gov.uk/", name: o.title, score, strength: strengthOf(score) ?? "possible", status: null, incorporated: null, companyType: null, people: [], appointments: o.appointment_count ?? null }));
    return { id, label, state: "ok", hits };
  } catch (err) {
    return fail(id, label, err);
  }
}

// ── ICIJ Offshore Leaks ──────────────────────────────────────────────────

export interface OffshoreHit {
  id: string;
  url: string;
  name: string;
  type: string | null;
  score: number;
  strength: Strength;
}

export async function checkOffshoreLeaks(name: string, kind: Kind): Promise<Check<OffshoreHit>> {
  const id = "offshore_leaks";
  const label = "ICIJ Offshore Leaks database";
  try {
    const queries = { q0: { query: name, type: kind === "entity" ? "Entity" : "Officer", limit: 8 } };
    const r = await getJson<{ q0?: { result?: { id: string; name: string; type?: { name?: string }[] }[] } }>(`https://offshoreleaks.icij.org/api/v1/reconcile?queries=${encodeURIComponent(JSON.stringify(queries))}`);
    if (r.status !== 200 || !r.body) return { id, label, state: "unavailable", note: `Offshore Leaks answered ${r.status}`, hits: [] };
    const hits: OffshoreHit[] = (r.body.q0?.result ?? [])
      .map((x) => ({ x, score: nameSimilarity(name, x.name, kind) }))
      .filter((m) => m.score >= POSSIBLE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ x, score }) => ({ id: String(x.id), url: `https://offshoreleaks.icij.org/nodes/${x.id}`, name: x.name, type: x.type?.[0]?.name ?? null, score, strength: strengthOf(score) ?? "possible" }));
    return { id, label, state: "ok", note: "Appearing in the Offshore Leaks is not evidence of wrongdoing: offshore structures are lawful. Data: ICIJ, Open Database License.", hits };
  } catch (err) {
    return fail(id, label, err);
  }
}

// ── Registry link-outs ───────────────────────────────────────────────────

export interface RegistryLink {
  label: string;
  url: string;
  note?: string;
}

const NATIONAL: Record<string, RegistryLink[]> = {
  KE: [{ label: "Kenya: Business Registration Service (eCitizen)", url: "https://brs.go.ke/" }],
  NG: [{ label: "Nigeria: Corporate Affairs Commission search", url: "https://search.cac.gov.ng/" }],
  ZA: [{ label: "South Africa: CIPC company search", url: "https://eservices.cipc.co.za/" }],
  GH: [{ label: "Ghana: Office of the Registrar of Companies", url: "https://orc.gov.gh/" }],
  UG: [{ label: "Uganda: URSB business search", url: "https://ursb.go.ug/" }],
  TZ: [{ label: "Tanzania: BRELA registry", url: "https://www.brela.go.tz/" }],
  RW: [{ label: "Rwanda: Rwanda Development Board registry", url: "https://www.rdb.rw/" }],
};

/** Official registries to search by hand: national registers rarely have an open API, so these open the register itself. */
export function registryLinks(name: string, countryCode: string | null): RegistryLink[] {
  const q = encodeURIComponent(name);
  return [
    ...(countryCode ? NATIONAL[countryCode.toUpperCase()] ?? [] : []),
    { label: "OpenCorporates: company search across registers", url: `https://opencorporates.com/companies?q=${q}` },
    { label: "OCCRP Aleph (free account for journalists and researchers)", url: `https://aleph.occrp.org/search?q=${q}` },
    { label: "World Bank debarred firms and individuals", url: "https://www.worldbank.org/debarr", note: "Search by name on the page." },
    { label: "Open Ownership register of beneficial owners", url: `https://register.openownership.org/search?q=${q}` },
  ];
}
