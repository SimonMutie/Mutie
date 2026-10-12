import { useMemo } from "react";
import type { SpotlightEntry } from "../api";
import { AFRICA } from "./viz/geo";
import "./Spotlight.css";

/**
 * Countries under Regional Spotlight → Africa: a directory of every country
 * grouped by part of the continent, and a page per country that gathers its
 * publications and any country-level products (Kenya has the Election Watch).
 */

const GROUPS: { name: string; codes: string[] }[] = [
  { name: "North Africa", codes: ["MA", "DZ", "TN", "LY", "EG", "EH"] },
  { name: "Horn of Africa and the Nile", codes: ["SD", "SS", "ET", "ER", "DJ", "SO"] },
  { name: "East Africa", codes: ["KE", "UG", "TZ", "RW", "BI"] },
  { name: "Central Africa", codes: ["CD", "CG", "CF", "CM", "TD", "GA", "GQ", "ST", "AO"] },
  { name: "West Africa and the Sahel", codes: ["NG", "GH", "SN", "CI", "ML", "NE", "BF", "BJ", "TG", "GM", "GW", "GN", "SL", "LR", "MR", "CV"] },
  { name: "Southern Africa and the islands", codes: ["ZA", "ZW", "ZM", "MW", "MZ", "BW", "NA", "LS", "SZ", "MG", "MU", "SC", "KM"] },
];

/** Countries outside Africa that have a directory entry (Middle East so far). */
const OTHER_COUNTRIES: Record<string, { label: string; name: string }> = {
  YE: { label: "Yemen", name: "Yemen" },
};
export const MIDDLE_EAST_GROUPS: { name: string; codes: string[] }[] = [{ name: "Arabian Peninsula and the Red Sea", codes: ["YE"] }];

/** Countries that have a product of their own beyond the publications list. */
export const COUNTRY_PRODUCTS: Record<string, { title: string; blurb: string; tag: string }[]> = {
  KE: [{ title: "Election Watch 2027", blurb: "Timeline to 10 August 2027, registered voters and population by county, declared candidates with profiles, the latest polls with credibility grades, and an assessment of how the vote could go.", tag: "Election" }],
  YE: [{ title: "Yemen and the Red Sea", blurb: "Live report on the Houthi escalation, Bab el-Mandeb and Gulf of Aden shipping, humanitarian access, displacement, Horn interactions, realignments and foreign military presence on the Red Sea and Aden coasts.", tag: "Special Report" }],
  SS: [{ title: "Political networks", blurb: "Who is tied to whom in South Sudan's power structure: command lines, alliances, kinship, enmity and defections between the main figures and institutions, grouped by camp.", tag: "Networks" }, { title: "Transition and Conflict Watch", blurb: "The 22 December 2026 election, government changes since 2025 shown as a timeline of posts, the Revitalised Agreement’s benchmarks and reported breaches, and a live conflict dashboard by state.", tag: "Transition" }],
};

export const flag = (iso2: string) => (iso2.length === 2 ? String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");
const label = (iso2: string) => AFRICA.find((a) => a.iso2 === iso2)?.label ?? OTHER_COUNTRIES[iso2]?.label ?? iso2;

/** The publications that name a country. */
export function entriesFor(entries: SpotlightEntry[] | null, iso2: string): SpotlightEntry[] {
  const a = AFRICA.find((x) => x.iso2 === iso2);
  const other = OTHER_COUNTRIES[iso2];
  if ((!a && !other) || !entries) return [];
  const names = (a ? [a.label, a.name, ...(a.also ?? [])] : [other.label, other.name]).map((n) => n.toLowerCase());
  return entries.filter((e) => {
    const c = (e.countries ?? "").toLowerCase();
    return c && names.some((n) => c.split(/[,;/]|\band\b/).some((part) => part.trim() === n));
  });
}

export function CountryDirectory({ entries, onOpen, groups: given }: { entries: SpotlightEntry[] | null; onOpen: (iso2: string) => void; groups?: { name: string; codes: string[] }[] }) {
  const counts = useMemo(() => new Map([...AFRICA.map((a) => a.iso2), ...Object.keys(OTHER_COUNTRIES)].map((c) => [c, entriesFor(entries, c).length])), [entries]);
  const known = new Set(GROUPS.flatMap((g) => g.codes));
  const other = AFRICA.filter((a) => !known.has(a.iso2)).map((a) => a.iso2);
  const groups = given ?? (other.length ? [...GROUPS, { name: "Other", codes: other }] : GROUPS);
  return (
    <section className="spotlight-countries" aria-label="Countries">
      <h2>Countries</h2>
      <p className="spotlight-countries__lead">Pick a country for its publications and country products.</p>
      {groups.map((g) => (
        <div key={g.name} className="spotlight-countries__group">
          <h3>{g.name}</h3>
          <ul>
            {g.codes.map((code) => {
              const products = COUNTRY_PRODUCTS[code];
              const n = counts.get(code) ?? 0;
              return (
                <li key={code}>
                  <button type="button" onClick={() => onOpen(code)} className={products ? "has-product" : ""}>
                    <span className="spotlight-countries__flag" aria-hidden="true">{flag(code)}</span>
                    <span className="spotlight-countries__name">{label(code)}</span>
                    {products && <span className="spotlight-countries__badge">{products[0].tag}</span>}
                    {n > 0 && <span className="spotlight-countries__n">{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function CountryPage(props: {
  iso2: string;
  entries: SpotlightEntry[] | null;
  isAdmin: boolean;
  onBack: () => void;
  onOpenEntry: (id: string) => void;
  onOpenProduct: (title: string) => void;
  regionName?: string;
}) {
  const { iso2, entries } = props;
  const region = props.regionName ?? "Africa";
  const name = label(iso2);
  const products = COUNTRY_PRODUCTS[iso2] ?? [];
  const list = entriesFor(entries, iso2).filter((e) => props.isAdmin || e.status === "published");
  return (
    <div className="spotlight-page">
      <div className="spotlight-wrap">
        <button type="button" className="spotlight-back" onClick={props.onBack}>← {region}</button>
        <div className="spotlight-head">
          <div>
            <p className="spotlight-head__section">Regional Spotlight · {region}</p>
            <h1><span aria-hidden="true">{flag(iso2)}</span> {name}</h1>
          </div>
        </div>

        {products.length > 0 && (
          <div className="spotlight-products">
            {products.map((p) => (
              <button key={p.title} type="button" className="spotlight-product" onClick={() => props.onOpenProduct(p.title)}>
                <span className="spotlight-countries__badge">{p.tag}</span>
                <strong>{p.title}</strong>
                <span>{p.blurb}</span>
                <em>Open →</em>
              </button>
            ))}
          </div>
        )}

        <h2 className="spotlight-subhead">Publications</h2>
        {entries === null && <div className="spotlight-empty">Loading…</div>}
        {entries && list.length === 0 && (
          <div className="spotlight-empty">
            <strong>Nothing filed for {name} yet.</strong>
            Publications whose Countries field names {name} will appear here.
          </div>
        )}
        <ul className="spotlight-list">
          {list.map((e) => (
            <li key={e.id} className="spotlight-row">
              <div className="spotlight-row__date">
                <strong>{new Date(`${e.publication_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</strong>
                <span>{e.publication_date.slice(0, 4)}</span>
              </div>
              <div>
                <p className="spotlight-row__meta"><span className="spotlight-type">{e.product_type}</span></p>
                <button type="button" className="spotlight-row__title" onClick={() => props.onOpenEntry(e.id)}>{e.title}</button>
                {e.summary && <p className="spotlight-row__summary">{e.summary}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
