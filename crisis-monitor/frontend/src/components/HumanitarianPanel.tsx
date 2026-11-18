import { useEffect, useMemo, useState } from "react";
import { api, type HumanitarianAnalysisData } from "../api";
import AlertDeliveryPanel from "./AlertDeliveryPanel";
import { card, chip, footnote, ghost, heading, input, muted, select, small, tag, text } from "./panelUi";

/**
 * Strategic humanitarian analyses (Threats & Intel): reflections from think tanks and research centres on how
 * humanitarianism is changing (funding cuts, the reset, localisation, Global South actors, access and more), focused
 * on Africa. Collected hourly by the server (lib/humanitarianAnalysis.ts); new pieces can be sent as alerts.
 */
type Tab = "analyses" | "alerts" | "sources";
const SEEN_KEY = "lens.humanitarian.seen";
const THEME_COLOURS = ["#D4AF37", "#22d3ee", "#f472b6", "#a78bfa", "#4ade80", "#fb923c", "#60a5fa", "#facc15", "#f87171", "#2dd4bf", "#c084fc"];

export default function HumanitarianPanel({ isAdmin, onLocate }: { isAdmin: boolean; onLocate: (lat: number, lng: number) => void }) {
  const [tab, setTab] = useState<Tab>("analyses");
  const [data, setData] = useState<HumanitarianAnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(60);
  const [all, setAll] = useState(false);
  const [theme, setTheme] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // What was new since this browser last opened the panel.
  const [seenAt] = useState<string>(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const load = () =>
    api
      .getHumanitarianAnalysis(days, all)
      .then((d) => {
        setData(d);
        setError(null);
        try {
          localStorage.setItem(SEEN_KEY, new Date().toISOString());
        } catch {
          /* storage unavailable */
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load analyses."));
  useEffect(() => {
    void load();
  }, [days, all]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (id: string) => data?.themes.find((t) => t.id === id)?.label ?? id;
  const colour = (id: string) => THEME_COLOURS[Math.max(0, data?.themes.findIndex((t) => t.id === id) ?? 0) % THEME_COLOURS.length];

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => (!theme || i.themes.includes(theme)) && (!needle || `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(needle)));
  }, [data, theme, q]);
  const themeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of data?.items ?? []) for (const t of i.themes) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [data]);

  async function collectNow() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.refreshHumanitarianAnalysis();
      setNote(`Collected from ${r.sources} sources: ${r.added} new.`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Collection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, color: text, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {(["analyses", "alerts", "sources"] as const).map((t) => (
          <button key={t} style={chip(tab === t)} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === "analyses" ? "Analyses" : t === "alerts" ? "Alerts" : "Sources & keywords"}
          </button>
        ))}
      </div>

      {tab === "analyses" && (
        <>
          <div style={{ color: muted, lineHeight: 1.45 }}>
            Strategic reflections on the changing humanitarian landscape from think tanks and research centres, focused on Africa. Pieces about African countries are pinned on the map.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 160px" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, summaries, sources" aria-label="Search analyses" />
            <select style={select} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How far back">
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={180}>6 months</option>
              <option value={365}>1 year</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={chip(!all)} onClick={() => setAll(false)} title="About Africa, or a system-level reflection that shapes Africa">
              Africa & system-level
            </button>
            <button style={chip(all)} onClick={() => setAll(true)}>
              Everything collected
            </button>
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button style={chip(theme === null)} onClick={() => setTheme(null)}>
              All themes
            </button>
            {(data?.themes ?? [])
              .filter((t) => themeCounts.get(t.id))
              .map((t) => (
                <button key={t.id} style={chip(theme === t.id)} onClick={() => setTheme(theme === t.id ? null : t.id)}>
                  {t.label} <span style={{ opacity: 0.7 }}>{themeCounts.get(t.id)}</span>
                </button>
              ))}
          </div>

          {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
          {!data && !error && <div style={{ color: muted }}>Loading…</div>}
          {data && items.length === 0 && (
            <div style={{ color: muted, lineHeight: 1.45 }}>
              Nothing {theme ? `on ${label(theme)} ` : ""}in this period yet. The collection runs every hour; new sources can take a cycle or two to appear.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((i) => {
              const isNew = !!seenAt && i.firstSeen > seenAt;
              return (
                <div key={i.id} style={{ ...card, borderColor: isNew ? "rgba(212,175,55,0.55)" : undefined }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    {isNew && <span style={tag("#D4AF37")}>NEW</span>}
                    <span style={{ color: muted, fontSize: 11 }}>
                      {i.source} · {new Date(i.published).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <a href={i.url} target="_blank" rel="noreferrer" style={{ color: text, fontWeight: 700, fontSize: 12.5, lineHeight: 1.35, textDecoration: "none" }}>
                    {i.title}
                  </a>
                  {i.summary && <div style={{ color: muted, marginTop: 4, lineHeight: 1.45 }}>{i.summary.length > 260 ? `${i.summary.slice(0, 259)}…` : i.summary}</div>}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                    {i.themes.slice(0, 4).map((t) => (
                      <span key={t} style={tag(colour(t))}>
                        {label(t)}
                      </span>
                    ))}
                    {i.countries.length > 0 && <span style={{ color: muted, fontSize: 10.5 }}>· {i.countries.slice(0, 5).join(", ")}</span>}
                    {i.lat != null && i.lng != null && (
                      <button style={{ ...small, marginLeft: "auto" }} onClick={() => onLocate(i.lat!, i.lng!)}>
                        Locate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "alerts" && <AlertDeliveryPanel target={{ scope: "humanitarian" }} compact />}

      {tab === "sources" && (
        <>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={ghost} onClick={() => void collectNow()} disabled={busy}>
                {busy ? "Collecting…" : "Collect now"}
              </button>
              {note && <span style={{ color: muted }}>{note}</span>}
            </div>
          )}
          <div style={heading}>Sources ({data?.sources.length ?? 0})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(data?.sources ?? []).map((s) => (
              <div key={s.url} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 11.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, flex: "0 0 8px", background: s.status === "ok" ? "#4ade80" : s.status === "error" ? "#f87171" : "#93a1b8" }} />
                <a href={s.url} target="_blank" rel="noreferrer" style={{ color: text, flex: 1 }}>
                  {s.name}
                </a>
                <span style={{ color: muted }} title={s.error ?? undefined}>
                  {s.status === "ok" ? `${s.kept} of ${s.items} relevant` : s.status === "error" ? (s.error ?? "error") : s.status}
                </span>
              </div>
            ))}
          </div>
          <div style={{ ...heading, marginTop: 10 }}>Keyword taxonomy</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(data?.themes ?? []).map((t) => (
              <details key={t.id} style={card}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  <span style={{ color: colour(t.id) }}>●</span> {t.label}
                  {t.systemic && <span style={{ color: muted, fontWeight: 400 }}> · system-level</span>}
                </summary>
                <div style={{ color: muted, marginTop: 6, lineHeight: 1.5 }}>{t.terms.map((x) => x.replace(/\*$/, "…")).join(" · ")}</div>
              </details>
            ))}
          </div>
          <div style={footnote}>
            A piece is kept when it is about humanitarian action and matches at least one theme, and it is about Africa (or comes from an African source), or it is a system-level reflection that shapes Africa. Sources marked red have no feed the Lens can read; they are retried every week.
          </div>
        </>
      )}
    </div>
  );
}
