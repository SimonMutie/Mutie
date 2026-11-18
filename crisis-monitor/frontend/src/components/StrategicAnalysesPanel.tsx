import { useEffect, useMemo, useState } from "react";
import { MapPin, X } from "lucide-react";
import { api, type AnalysisDomain, type StrategicAnalysesData, type StrategicAnalysis } from "../api";
import AlertDeliveryPanel from "./AlertDeliveryPanel";
import { accent, card, chip, footnote, ghost, heading, input, muted, select, tag, text } from "./panelUi";

/**
 * Strategic Analyses (Live OSINT → Analyses): a pop-up over the map with a tab per domain (New Humanitarianism,
 * Geopolitics, Elections, Economy, Trade, Cybersecurity, Conflict). Each tab lists what think tanks and research
 * centres have published on Africa in that domain, its alerts, and its sources and keyword taxonomy. Collected by the
 * server (lib/strategicAnalysis.ts).
 */
type Sub = "analyses" | "alerts" | "sources";
const DOMAIN_ORDER: { id: AnalysisDomain; label: string }[] = [
  { id: "humanitarian", label: "New Humanitarianism" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "elections", label: "Elections" },
  { id: "economy", label: "Economy" },
  { id: "trade", label: "Trade" },
  { id: "cyber", label: "Cybersecurity" },
  { id: "conflict", label: "Conflict" },
];
const TAB_KEY = "lens.analyses.tab";
const seenKey = (d: AnalysisDomain) => `lens.analyses.seen.${d}`;
const THEME_COLOURS = ["#D4AF37", "#22d3ee", "#f472b6", "#a78bfa", "#4ade80", "#fb923c", "#60a5fa", "#facc15", "#f87171", "#2dd4bf", "#c084fc"];

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) ?? "";
    } catch {
      return "";
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

export default function StrategicAnalysesPanel({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const [domain, setDomain] = useState<AnalysisDomain>(() => (DOMAIN_ORDER.find((d) => d.id === store.get(TAB_KEY))?.id ?? "humanitarian"));
  const [sub, setSub] = useState<Sub>("analyses");
  const [data, setData] = useState<StrategicAnalysesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(365);
  const [all, setAll] = useState(false);
  const [theme, setTheme] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [country, setCountry] = useState<string>("");
  const [bloc, setBloc] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // When each tab was last opened in this browser, captured as the tab opens, so its new pieces stay marked while it is read.
  const [seenAt, setSeenAt] = useState<string>(() => store.get(seenKey(domain)));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .getStrategicAnalyses(domain, days, all)
      .then((d) => {
        if (!live) return;
        setData(d);
        store.set(seenKey(domain), new Date().toISOString());
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load analyses."));
    return () => {
      live = false;
    };
  }, [domain, days, all, tick]);

  function pick(d: AnalysisDomain) {
    if (d === domain) return;
    setSeenAt(store.get(seenKey(d)));
    setDomain(d);
    setTheme(null);
    setRegion(null);
    setCountry("");
    setBloc(null);
    setKind("");
    setQ("");
    setAll(false);
    setData(null);
    store.set(TAB_KEY, d);
  }

  const current = data && data.domain === domain ? data : null;
  const meta = (id: AnalysisDomain) => data?.domains.find((d) => d.id === id);
  const label = (id: string) => current?.themes.find((t) => t.id === id)?.label ?? id;
  const colour = (id: string) => THEME_COLOURS[Math.max(0, current?.themes.findIndex((t) => t.id === id) ?? 0) % THEME_COLOURS.length];
  const domainLabel = DOMAIN_ORDER.find((d) => d.id === domain)!.label;

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (current?.items ?? []).filter(
      (i) =>
        (!theme || i.themes.includes(theme)) &&
        (!region || i.regions.includes(region)) &&
        (!country || i.countries.includes(country)) &&
        (!bloc || i.blocs.includes(bloc)) &&
        (!kind || i.sourceKind === kind) &&
        (!needle || `${i.title} ${i.summary} ${i.source} ${i.places.join(" ")}`.toLowerCase().includes(needle))
    );
  }, [current, theme, region, country, bloc, kind, q]);
  const countOf = (pick: (i: StrategicAnalysis) => string[]) => {
    const m = new Map<string, number>();
    for (const i of current?.items ?? []) for (const v of pick(i)) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const regionCounts = useMemo(() => countOf((i) => i.regions), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const countryCounts = useMemo(() => countOf((i) => i.countries), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocCounts = useMemo(() => countOf((i) => i.blocs), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const kindCounts = useMemo(() => countOf((i) => (i.sourceKind ? [i.sourceKind] : [])), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const cname = (c: string) => current?.countryNames[c] ?? c;
  const filtered = !!(theme || region || country || bloc || kind || q.trim());
  const themeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of current?.items ?? []) for (const t of i.themes) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [current]);

  async function collectNow() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.refreshStrategicAnalyses();
      setNote(r.ran ? `Read ${r.sources} sources: ${r.added} new pieces across the tabs.` : "Every source was read in the last hour.");
      setTick((t) => t + 1);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Collection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(2,6,14,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        role="dialog"
        aria-label="Strategic Analyses"
        style={{
          width: "min(1040px, 96vw)",
          height: "min(860px, 90vh)",
          display: "flex",
          flexDirection: "column",
          background: "rgba(8,10,20,0.97)",
          border: "1px solid rgba(212,175,55,0.28)",
          borderRadius: 12,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          color: text,
          fontSize: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 10px" }}>
          <div>
            <div style={{ fontSize: 15, letterSpacing: "0.22em", fontWeight: 800, color: accent }}>STRATEGIC ANALYSES</div>
            <div style={{ color: muted, fontSize: 11.5, marginTop: 3 }}>What think tanks and research centres are publishing on Africa, by domain.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: muted, cursor: "pointer", padding: 4, display: "flex" }}>
            <X size={18} />
          </button>
        </div>

        <div role="tablist" style={{ display: "flex", gap: 2, padding: "0 14px", borderBottom: "1px solid rgba(212,175,55,0.18)", overflowX: "auto", flexShrink: 0 }}>
          {DOMAIN_ORDER.map((d) => {
            const on = d.id === domain;
            const m = meta(d.id);
            const fresh = !on && !!m?.latest && m.latest > store.get(seenKey(d.id));
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={on}
                onClick={() => pick(d.id)}
                style={{
                  position: "relative",
                  padding: "9px 13px 10px",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: on ? 700 : 500,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${on ? accent : "transparent"}`,
                  color: on ? accent : text,
                  marginBottom: -1,
                }}
              >
                {d.label}
                {m && m.recent > 0 && <span style={{ color: muted, fontWeight: 400, marginLeft: 5, fontSize: 10.5 }}>{m.recent}</span>}
                {fresh && <span title="New since you last looked" style={{ position: "absolute", top: 7, right: 4, width: 6, height: 6, borderRadius: 3, background: accent }} />}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6, padding: "10px 18px 0", alignItems: "center", flexShrink: 0 }}>
          {(["analyses", "alerts", "sources"] as const).map((t) => (
            <button key={t} style={{ ...chip(sub === t), whiteSpace: "nowrap", flexShrink: 0 }} aria-pressed={sub === t} onClick={() => setSub(t)}>
              {t === "analyses" ? "Analyses" : t === "alerts" ? "Alerts" : "Sources & keywords"}
            </button>
          ))}
          {meta(domain)?.blurb && <span style={{ color: muted, marginLeft: 8, fontSize: 11, lineHeight: 1.35 }}>{meta(domain)!.blurb}</span>}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px 18px" }}>
          {sub === "analyses" && (
            <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input style={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, summaries, sources" aria-label="Search analyses" />
                <select style={{ ...select, width: "100%" }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How far back">
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days</option>
                  <option value={180}>Last 6 months</option>
                  <option value={365}>Last year</option>
                </select>
                <select style={{ ...select, width: "100%" }} value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
                  <option value="">All countries</option>
                  {[...countryCounts.entries()]
                    .sort((a, b) => cname(a[0]).localeCompare(cname(b[0])))
                    .map(([c, n]) => (
                      <option key={c} value={c}>
                        {cname(c)} ({n})
                      </option>
                    ))}
                </select>
                <select style={{ ...select, width: "100%" }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type of source">
                  <option value="">All types of source</option>
                  {[...kindCounts.entries()].map(([k, n]) => (
                    <option key={k} value={k}>
                      {k} ({n})
                    </option>
                  ))}
                </select>
                {filtered && (
                  <button
                    style={ghost}
                    onClick={() => {
                      setTheme(null);
                      setRegion(null);
                      setCountry("");
                      setBloc(null);
                      setKind("");
                      setQ("");
                    }}
                  >
                    Clear filters
                  </button>
                )}
                <div style={heading}>Regions</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {(current?.regions ?? []).map((r) => {
                    const n = regionCounts.get(r) ?? 0;
                    return (
                      <button key={r} disabled={!n} style={{ ...chip(region === r), opacity: n ? 1 : 0.4, cursor: n ? "pointer" : "default" }} onClick={() => setRegion(region === r ? null : r)}>
                        {r} <span style={{ opacity: 0.7 }}>{n || ""}</span>
                      </button>
                    );
                  })}
                </div>
                {blocCounts.size > 0 && (
                  <>
                    <div style={heading}>Blocs & bodies</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {[...blocCounts.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([b, n]) => (
                          <button key={b} style={chip(bloc === b)} onClick={() => setBloc(bloc === b ? null : b)}>
                            {b} <span style={{ opacity: 0.7 }}>{n}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
                {domain === "humanitarian" && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <button style={chip(!all)} onClick={() => setAll(false)} title="About Africa, or a system-level reflection that shapes Africa">
                      Africa & system-level
                    </button>
                    <button style={chip(all)} onClick={() => setAll(true)}>
                      Everything
                    </button>
                  </div>
                )}
                <div style={heading}>Themes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button style={{ ...chip(theme === null), textAlign: "left" }} onClick={() => setTheme(null)}>
                    All themes <span style={{ opacity: 0.7 }}>{current?.items.length ?? ""}</span>
                  </button>
                  {(current?.themes ?? []).map((t) => {
                    const n = themeCounts.get(t.id) ?? 0;
                    return (
                      <button key={t.id} disabled={!n} style={{ ...chip(theme === t.id), textAlign: "left", opacity: n ? 1 : 0.4, cursor: n ? "pointer" : "default" }} onClick={() => setTheme(theme === t.id ? null : t.id)}>
                        <span style={{ color: theme === t.id ? undefined : colour(t.id) }}>●</span> {t.label} <span style={{ opacity: 0.7 }}>{n || ""}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
                {!current && !error && <div style={{ color: muted }}>Loading…</div>}
                {current && items.length === 0 && (
                  <div style={{ color: muted, lineHeight: 1.5 }}>
                    Nothing {theme ? `on ${label(theme)} ` : ""}in this period yet. Every source is read hourly and its past year is being fetched a few sources at a time, so the list keeps filling over the next few hours.
                  </div>
                )}
                {items.map((i) => {
                  const isNew = !!seenAt && i.firstSeen > seenAt;
                  return (
                    <div key={i.id} style={{ ...card, borderColor: isNew ? "rgba(212,175,55,0.55)" : undefined }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                        {isNew && <span style={tag(accent)}>NEW</span>}
                        {i.sourceKind === "Analyst / newsletter" && <span style={tag("#a78bfa")}>ANALYST</span>}
                        {i.sourceKind === "African think tank" && <span style={tag("#4ade80")}>AFRICAN THINK TANK</span>}
                        <span style={{ color: muted, fontSize: 11 }}>
                          {i.source} · {new Date(i.published).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      <a href={i.url} target="_blank" rel="noreferrer" style={{ color: text, fontWeight: 700, fontSize: 13, lineHeight: 1.35, textDecoration: "none" }}>
                        {i.title}
                      </a>
                      {i.summary && <div style={{ color: muted, marginTop: 4, lineHeight: 1.5 }}>{i.summary.length > 360 ? `${i.summary.slice(0, 359)}…` : i.summary}</div>}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 7, alignItems: "center" }}>
                        {i.themes.slice(0, 4).map((t) => (
                          <span key={t} style={tag(colour(t))}>
                            {label(t)}
                          </span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5, fontSize: 10.5, color: muted }}>
                        {i.places.length > 0 && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: text }}>
                            <MapPin size={10} /> {i.places.slice(0, 4).join(", ")}
                          </span>
                        )}
                        {i.countries.length > 0 && <span>{i.countries.slice(0, 6).map(cname).join(", ")}</span>}
                        {i.countries.length === 0 && i.regions.length > 0 && <span>{i.regions.join(", ")}</span>}
                        {i.blocs.length > 0 && <span style={{ color: "#9db4ff" }}>{i.blocs.join(" · ")}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sub === "alerts" && (
            <div style={{ maxWidth: 620 }}>
              <AlertDeliveryPanel key={domain} target={{ scope: "analyses", domain, label: domainLabel }} compact />
            </div>
          )}

          {sub === "sources" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
              <div>
                {isAdmin && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <button style={ghost} onClick={() => void collectNow()} disabled={busy}>
                      {busy ? "Collecting…" : "Collect now"}
                    </button>
                    {note && <span style={{ color: muted }}>{note}</span>}
                  </div>
                )}
                {isAdmin && current?.diagnostics && <Diagnostics d={current.diagnostics} />}
                <div style={heading}>Sources for {domainLabel} ({current?.sources.length ?? 0})</div>
                {["African think tank", "International think tank", "Analyst / newsletter", "Specialist outlet"].map((k) => {
                  const list = (current?.sources ?? []).filter((s) => s.kind === k);
                  if (!list.length) return null;
                  return (
                <div key={k} style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
                  <div style={{ color: accent, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {k === "Analyst / newsletter" ? "Analysts & newsletters" : `${k}s`} ({list.length})
                  </div>
                  {list.map((s) => (
                    <div key={s.url} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 11.5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, flex: "0 0 8px", background: s.status === "ok" ? "#4ade80" : s.status === "error" ? "#f87171" : "#93a1b8" }} />
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ color: text, flex: 1 }}>
                        {s.name}
                      </a>
                      <span style={{ color: muted, textAlign: "right" }} title={[s.error, s.backfill && `Past year: ${s.backfill}`].filter(Boolean).join(" · ") || undefined}>
                        {s.status === "ok" ? `${s.kept} of ${s.items} relevant` : s.status === "error" ? `${s.error ?? "error"}${s.backfill ? " · found via Google News" : ""}` : s.status}
                        {!s.backfill && <span style={{ color: "#facc15" }}> · past year pending</span>}
                      </span>
                    </div>
                  ))}
                </div>
                  );
                })}
              </div>
              <div>
                <div style={heading}>Boolean query</div>
                <div style={{ ...card, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, lineHeight: 1.6, marginBottom: 10 }}>
                  <span style={{ color: accent }}>({domainLabel} signal)</span> AND <span style={{ color: accent }}>(ANY theme below)</span>
                  {domain === "humanitarian" ? (
                    <>
                      {" "}AND <span style={{ color: accent }}>(Africa OR system-level OR names no crisis outside Africa)</span>
                    </>
                  ) : (
                    <>
                      {" "}AND <span style={{ color: accent }}>(Africa)</span>
                    </>
                  )}{" "}
                  NOT <span style={{ color: "#f87171" }}>(site pages, notices, vacancies, events, calls, press releases)</span>
                  <div style={{ color: muted, marginTop: 4, fontFamily: "inherit" }}>
                    {domain === "humanitarian" ? "Humanitarian specialist sources skip the signal and theme tests: everything they publish is kept. " : ""}
                    Theme = (term OR term OR …) OR ((group) AND (group)). {totalTerms(current?.themes ?? [])} terms; the AND rules stand for about {combos(current?.themes ?? []).toLocaleString("en-GB")} term combinations.
                  </div>
                </div>
                <div style={heading}>Keyword taxonomy</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(current?.themes ?? []).map((t) => (
                    <details key={t.id} style={card}>
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                        <span style={{ color: colour(t.id) }}>●</span> {t.label}
                        {t.systemic && <span style={{ color: muted, fontWeight: 400 }}> · system-level</span>}
                        {t.context && <span style={{ color: muted, fontWeight: 400 }}> · context only</span>}
                        <span style={{ color: muted, fontWeight: 400 }}> · {t.terms.length + t.rules.flat(2).length} terms{t.rules.length ? ` · ${t.rules.length} AND rule${t.rules.length > 1 ? "s" : ""}` : ""}</span>
                      </summary>
                      <div style={{ color: muted, marginTop: 6, lineHeight: 1.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5 }}>
                        {t.terms.length > 0 && <div>({t.terms.map(bq).join(" OR ")})</div>}
                        {t.rules.map((rule, ri) => (
                          <div key={ri} style={{ marginTop: 6 }}>
                            <span style={{ color: accent }}>OR </span>
                            {rule.map((g, gi) => (
                              <span key={gi}>
                                {gi > 0 && <span style={{ color: accent }}> AND </span>}({g.map(bq).join(" OR ")})
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
                <div style={{ ...footnote, marginTop: 10 }}>
                  Terms are matched in English, French and Portuguese, ignoring accents and hyphens. A piece is kept when it is about this domain and matches its themes (two matches from a source that covers many domains), and it is about Africa or comes from an Africa-focused source. Places are recognised down to towns and provinces, and every piece is tagged with its African countries, regions and regional blocs.
                  {domain === "humanitarian" && " For New Humanitarianism, system-level reflections that shape Africa are kept even when they name no African country."} Each source's past year is fetched once (its sitemap, which lists every publication, plus older feed pages, newsletter archives and a Google News search of the site), and every source is also searched on Google News daily, so sites with no feed (marked red) are still covered. Hover over a source to see what its backfill found.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Admins only: what the collector is doing, so a stalled catch-up or failing sources are visible at a glance. */
function Diagnostics({ d }: { d: NonNullable<StrategicAnalysesData["diagnostics"]> }) {
  if (d.error) return <div style={{ ...card, color: "#f87171", marginBottom: 10 }}>Diagnostics unavailable: {d.error}</div>;
  const r = d.lastRun;
  const s = d.sources ?? {};
  const p = d.pages ?? {};
  const when = (t: string) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: muted }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
  return (
    <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
      <div style={{ ...heading, margin: 0 }}>Collector status (admin)</div>
      {r ? (
        row(
          "Last run",
          r.finishedAt ? (
            `${when(r.startedAt)}, ${r.seconds ?? "?"}s, ${r.added ?? 0} new · read ${r.lanes?.read ?? 0}, catch-up ${r.lanes?.backfill ?? 0}, sitemaps ${r.lanes?.sitemaps ?? 0}, pages ${r.lanes?.pages ?? 0}, searches ${r.lanes?.gnews ?? 0}${r.lanes?.skipped ? `, ${r.lanes.skipped} left for next run` : ""}`
          ) : (
            <span style={{ color: "#f87171" }}>started {when(r.startedAt)} and did not finish</span>
          )
        )
      ) : (
        row("Last run", "none recorded yet")
      )}
      {row("Sources", `${s.ok ?? 0} feeds working · ${s.failing ?? 0} without a readable feed · ${s.listed ?? 0} listed`)}
      {row("Past-year catch-up", `${s.backfilled ?? 0} of ${s.listed ?? 0} done${s.backfill_cut ? ` (${s.backfill_cut} cut short)` : ""}`)}
      {row("Sitemaps", `${s.sitemaps_read ?? 0} read · ${s.sitemaps_found ?? 0} listed publications`)}
      {row("Pages from sitemaps", `${p.pending ?? 0} waiting · ${p.done ?? 0} read · ${p.failed ?? 0} unreadable`)}
      {row("Stored", Object.entries(d.stored ?? {}).map(([k, v]) => `${k} ${v.inScope}`).join(" · ") || "nothing yet")}
      {r?.fetchFails && Object.keys(r.fetchFails).length > 0 &&
        row(
          "Failed requests last run",
          <span style={{ color: "#facc15" }}>
            {Object.entries(r.fetchFails)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([k, n]) => `${n} × ${k}`)
              .join(" · ")}
          </span>
        )}
      {(r?.errors?.length ?? 0) > 0 && <div style={{ color: "#f87171", marginTop: 4, lineHeight: 1.4 }}>{r!.errors!.slice(0, 5).join(" · ")}</div>}
    </div>
  );
}

/** A term as written in a Boolean query: phrases in quotes, a trailing * kept as the wildcard. */
const bq = (t: string) => (t.includes(" ") ? `"${t}"` : t);
const totalTerms = (themes: StrategicAnalysesData["themes"]) => themes.reduce((n, t) => n + t.terms.length + t.rules.flat(2).length, 0);
const combos = (themes: StrategicAnalysesData["themes"]) => themes.reduce((n, t) => n + t.rules.reduce((m, r) => m + r.reduce((k, g) => k * g.length, 1), 0), 0);
