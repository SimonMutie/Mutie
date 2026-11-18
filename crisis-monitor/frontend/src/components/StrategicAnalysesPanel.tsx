import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { api, type AnalysisDomain, type StrategicAnalysesData } from "../api";
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
  const [days, setDays] = useState(60);
  const [all, setAll] = useState(false);
  const [theme, setTheme] = useState<string | null>(null);
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
    return (current?.items ?? []).filter((i) => (!theme || i.themes.includes(theme)) && (!needle || `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(needle)));
  }, [current, theme, q]);
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
            <button key={t} style={chip(sub === t)} aria-pressed={sub === t} onClick={() => setSub(t)}>
              {t === "analyses" ? "Analyses" : t === "alerts" ? "Alerts" : "Sources & keywords"}
            </button>
          ))}
          {meta(domain)?.blurb && <span style={{ color: muted, marginLeft: 8, fontSize: 11, lineHeight: 1.35 }}>{meta(domain)!.blurb}</span>}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px 18px" }}>
          {sub === "analyses" && (
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, position: "sticky", top: 0 }}>
                <input style={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, summaries, sources" aria-label="Search analyses" />
                <select style={{ ...select, width: "100%" }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How far back">
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days</option>
                  <option value={180}>Last 6 months</option>
                  <option value={365}>Last year</option>
                </select>
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
                    Nothing {theme ? `on ${label(theme)} ` : ""}in this period yet. Every source is read about once an hour; a new tab can take an hour or two to fill.
                  </div>
                )}
                {items.map((i) => {
                  const isNew = !!seenAt && i.firstSeen > seenAt;
                  return (
                    <div key={i.id} style={{ ...card, borderColor: isNew ? "rgba(212,175,55,0.55)" : undefined }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                        {isNew && <span style={tag(accent)}>NEW</span>}
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
                        {i.countries.length > 0 && <span style={{ color: muted, fontSize: 10.5 }}>· {i.countries.slice(0, 6).join(", ")}</span>}
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
                <div style={heading}>Sources for {domainLabel} ({current?.sources.length ?? 0})</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {(current?.sources ?? []).map((s) => (
                    <div key={s.url} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 11.5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, flex: "0 0 8px", background: s.status === "ok" ? "#4ade80" : s.status === "error" ? "#f87171" : "#93a1b8" }} />
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ color: text, flex: 1 }}>
                        {s.name}
                      </a>
                      <span style={{ color: muted, textAlign: "right" }} title={s.error ?? undefined}>
                        {s.status === "ok" ? `${s.kept} of ${s.items} relevant` : s.status === "error" ? (s.error ?? "error") : s.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={heading}>Keyword taxonomy</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(current?.themes ?? []).map((t) => (
                    <details key={t.id} style={card}>
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                        <span style={{ color: colour(t.id) }}>●</span> {t.label}
                        {t.systemic && <span style={{ color: muted, fontWeight: 400 }}> · system-level</span>}
                      </summary>
                      <div style={{ color: muted, marginTop: 6, lineHeight: 1.5 }}>{t.terms.map((x) => x.replace(/\*$/, "…")).join(" · ")}</div>
                    </details>
                  ))}
                </div>
                <div style={{ ...footnote, marginTop: 10 }}>
                  A piece is kept when it is about this domain and matches its themes (two matches from a source that covers many domains), and it is about Africa or comes from an African source.
                  {domain === "humanitarian" && " For New Humanitarianism, system-level reflections that shape Africa are kept even when they name no African country."} Sources marked red have no feed the Lens can read; they are retried every week.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
