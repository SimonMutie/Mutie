import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, type LiveBroadcast, type LiveLayerFeature, type NewsBloc, type OsintAlertItem, type WatchZone } from "../api";
import { chip, hairline as line, input, muted, small, tag, text } from "./panelUi";

/**
 * Live Alerts: one place for the reports coming in, the
 * standing warnings, recent earthquakes and the live news channels.
 *
 *  All       everything below, newest first
 *  News      wire reports, with who carries them (Western, Russian-aligned, regional, independent)
 *  Warnings  watch zones, each with the reports and escalation incidents that fall in it
 *  Quakes    magnitude 4.5 and above
 *  Feeds     live news channels
 *
 * Telegram posts are not listed here: they are in the Telegram tool, with who runs each channel.
 *
 * Grouping reports by zone is keyword matching: it groups reports, it does not verify them.
 */
const BLOC: Record<NewsBloc, { short: string; color: string }> = {
  western: { short: "WEST", color: "#4F9CFF" },
  russian: { short: "RU-ALIGNED", color: "#A78BFA" },
  chinese: { short: "CN STATE", color: "#F59E0B" },
  regional: { short: "REGIONAL", color: "#2DD4BF" },
  independent: { short: "INDEPENDENT", color: "#C8C2B4" },
};
const SEVERITY: Record<WatchZone["severity"], { label: string; color: string }> = {
  war: { label: "ACTIVE WAR", color: "#FF3D3D" },
  high: { label: "HIGH TENSION", color: "#FF9500" },
  elevated: { label: "ELEVATED", color: "#FFD23F" },
};

export function timeAgo(iso: string | number | null | undefined): string {
  if (iso == null) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

type Tab = "all" | "news" | "warnings" | "quakes" | "feeds";

/** Which sides carry a set of reports: both Western and Russian-aligned, one side only, or neither of those two. */
function perspective(blocs: (NewsBloc | null)[]): { label: string; color: string; title: string } {
  const set = new Set(blocs.filter(Boolean));
  if (set.has("western") && set.has("russian")) return { label: "BOTH SIDES", color: "#00E676", title: "Carried by both Western and Russian-aligned outlets" };
  if (set.size === 1) return { label: "ONE SIDE", color: "#FF9500", title: "Every report comes from outlets of one perspective" };
  return { label: "MIXED", color: "#8A8880", title: "Sourcing does not include both Western and Russian-aligned outlets" };
}

export default function LiveAlertsPanel({ onLocate, pinsOn, onTogglePins, warningsOn, onToggleWarnings }: {
  onLocate: (lat: number, lng: number, zoom?: number) => void;
  pinsOn: boolean;
  onTogglePins: (on: boolean) => void;
  warningsOn: boolean;
  onToggleWarnings: (on: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [alerts, setAlerts] = useState<OsintAlertItem[] | null>(null);
  const [zones, setZones] = useState<WatchZone[] | null>(null);
  const [quakes, setQuakes] = useState<LiveLayerFeature[] | null>(null);
  const [feeds, setFeeds] = useState<LiveBroadcast[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [openZone, setOpenZone] = useState<string | null>(null);
  const [blocFilter, setBlocFilter] = useState<NewsBloc | "all">("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const errs: string[] = [];
    await Promise.all([
      // Telegram posts live in the Telegram tool (and the Telegram Posts layer), so they are not listed twice.
      api.getOsintAlerts().then((r) => setAlerts(r.alerts.filter((a) => !a.source.startsWith("t.me/")))).catch(() => errs.push("reports")),
      api.getWatchZones().then((r) => setZones(r.zones)).catch(() => errs.push("warnings")),
      api.getLiveEarthquakes().then((r) => setQuakes(r.features)).catch(() => errs.push("earthquakes")),
      api.getLiveBroadcasts().then((r) => setFeeds(r.broadcasts)).catch(() => errs.push("live channels")),
    ]);
    setErrors(errs);
    setRefreshing(false);
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 3 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const news = useMemo(
    () =>
      (alerts ?? [])
        .filter((a) => blocFilter === "all" || a.bloc === blocFilter)
        .filter((a) => !q || `${a.title} ${a.summary} ${a.source_name}`.toLowerCase().includes(q))
        .sort((a, b) => b.published.localeCompare(a.published)),
    [alerts, q, blocFilter]
  );
  const bigQuakes = useMemo(
    () =>
      (quakes ?? [])
        .filter((f) => !q || f.properties.title.toLowerCase().includes(q))
        .sort((a, b) => (b.properties.time ?? "").localeCompare(a.properties.time ?? "")),
    [quakes, q]
  );
  const shownZones = useMemo(
    () =>
      (zones ?? [])
        .filter((z) => !q || `${z.label} ${z.description} ${z.headlines.map((h) => h.title).join(" ")}`.toLowerCase().includes(q))
        .sort((a, b) => ["war", "high", "elevated"].indexOf(a.severity) - ["war", "high", "elevated"].indexOf(b.severity) || b.incidents.length + b.headlineCount - (a.incidents.length + a.headlineCount)),
    [zones, q]
  );
  const shownFeeds = useMemo(() => (feeds ?? []).filter((f) => !q || `${f.name} ${f.city} ${f.country}`.toLowerCase().includes(q)), [feeds, q]);

  const counts = { news: news.length, warnings: shownZones.length, quakes: bigQuakes.length, feeds: shownFeeds.length };

  const newsRow = (a: OsintAlertItem) => {
    const blocs = [a.bloc, ...a.also_reported_by.map((r) => r.bloc)];
    const p = a.also_reported_by.length ? perspective(blocs) : null;
    return (
      <div key={`n:${a.id}`} style={{ padding: "8px 0", borderBottom: line }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 3 }}>
          {a.flag && <span style={tag("#FF3D3D")}>BREAKING</span>}
          {a.bloc && <span style={tag(BLOC[a.bloc].color)}>{BLOC[a.bloc].short}</span>}
          {p && <span style={tag(p.color)} title={p.title}>{p.label}</span>}
          <span style={{ color: muted, fontSize: 10.5 }}>{a.source_name} · {timeAgo(a.published)}</span>
        </div>
        <a href={a.link} target="_blank" rel="noreferrer" style={{ color: text, textDecoration: "none", lineHeight: 1.4, display: "block" }}>{a.title}</a>
        {a.summary && a.summary !== a.title && <div style={{ color: muted, fontSize: 11, lineHeight: 1.45, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.summary}</div>}
        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
          {a.coords && !a.coords_default && <button style={small} onClick={() => onLocate(a.coords![0], a.coords![1], 7)}>Locate{a.coords_anchor ? ` · ${a.coords_anchor}` : ""}</button>}
          {a.also_reported_by.length > 0 && <span style={{ color: muted, fontSize: 10.5 }}>Also: {a.also_reported_by.map((r) => r.source_name).join(", ")}</span>}
        </div>
      </div>
    );
  };

  const zoneRow = (z: WatchZone) => {
    const sev = SEVERITY[z.severity];
    const open = openZone === z.id;
    return (
      <div key={`z:${z.id}`} style={{ padding: "8px 0", borderBottom: line }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 3 }}>
          <span style={tag(sev.color)}>⚠ {sev.label}</span>
          <span style={{ fontWeight: 700, fontSize: 12 }}>{z.label}</span>
        </div>
        <div style={{ color: muted, fontSize: 11, lineHeight: 1.45 }}>{z.description}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
          <button style={small} onClick={() => onLocate(z.lat, z.lng, 5)}>Locate</button>
          <button style={small} onClick={() => setOpenZone(open ? null : z.id)}>
            {open ? "Hide" : `${z.headlineCount} report${z.headlineCount === 1 ? "" : "s"} · ${z.incidents.length} incident${z.incidents.length === 1 ? "" : "s"}`}
          </button>
        </div>
        {open && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
            {z.incidents.slice(0, 10).map((i) => (
              <button key={i.id} onClick={() => onLocate(i.lat, i.lon, 8)} style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", color: text, fontFamily: "inherit", fontSize: 11, lineHeight: 1.4 }}>
                <span style={tag(i.level === "critical" ? "#FF3D3D" : i.level === "elevated" ? "#FF9D4F" : "#C9A227")}>{i.level.toUpperCase()}</span> {i.headline} <span style={{ color: muted }}>({i.place})</span>
              </button>
            ))}
            {z.headlines.slice(0, 12).map((h) => (
              <a key={h.url} href={h.url} target="_blank" rel="noreferrer" style={{ color: "#9db4ff", fontSize: 11, textDecoration: "none", lineHeight: 1.4 }}>
                {h.title} <span style={{ color: muted }}>({h.source}{h.published ? `, ${timeAgo(h.published)}` : ""})</span>
              </a>
            ))}
            {z.incidents.length === 0 && z.headlineCount === 0 && <div style={{ color: muted, fontSize: 11 }}>No reports or incidents in this zone in the current window.</div>}
          </div>
        )}
      </div>
    );
  };

  const quakeRow = (f: LiveLayerFeature) => {
    const [lng, lat] = f.geometry.coordinates;
    return (
      <div key={`q:${f.properties.id}`} style={{ padding: "8px 0", borderBottom: line }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 3 }}>
          <span style={tag("#ff5d5d")}>QUAKE</span>
          <span style={{ color: muted, fontSize: 10.5 }}>{f.properties.intensityLabel} · {timeAgo(f.properties.time)}</span>
        </div>
        <div style={{ lineHeight: 1.4 }}>{f.properties.title}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button style={small} onClick={() => onLocate(lat, lng, 6)}>Locate</button>
          {f.properties.url && <a href={f.properties.url} target="_blank" rel="noreferrer" style={{ ...small, textDecoration: "none" }}>USGS</a>}
        </div>
      </div>
    );
  };

  const feedRow = (f: LiveBroadcast) => (
    <div key={`f:${f.id}`} style={{ padding: "7px 0", borderBottom: line, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
      <div>
        <div style={{ fontWeight: 600 }}><span style={{ color: "#FF3D3D" }}>●</span> {f.name}</div>
        <div style={{ color: muted, fontSize: 10.5 }}>{f.city}, {f.country} · {f.category}</div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        <button style={small} onClick={() => onLocate(f.lat, f.lng, 5)}>Locate</button>
        <a href={f.url.replace("youtube-nocookie.com/embed/live_stream?channel=", "youtube.com/channel/").replace(/&.*$/, "/live")} target="_blank" rel="noreferrer" style={{ ...small, textDecoration: "none" }}>Watch</a>
      </div>
    </div>
  );

  const all = useMemo(() => {
    type Row = { at: number; el: () => JSX.Element };
    const rows: Row[] = [
      ...shownZones.filter((z) => z.incidents.length || z.headlineCount).map((z) => ({ at: Date.now() + (z.severity === "war" ? 3 : z.severity === "high" ? 2 : 1), el: () => zoneRow(z) })),
      ...news.slice(0, 80).map((a) => ({ at: Date.parse(a.published) || 0, el: () => newsRow(a) })),
      ...bigQuakes.slice(0, 15).map((f) => ({ at: Date.parse(f.properties.time ?? "") || 0, el: () => quakeRow(f) })),
    ];
    return rows.sort((a, b) => b.at - a.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownZones, news, bigQuakes, openZone]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, color: text, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {(["all", "news", "warnings", "quakes", "feeds"] as Tab[]).map((t) => (
          <button key={t} style={chip(tab === t)} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === "all" ? "All" : t === "news" ? `News ${counts.news}` : t === "warnings" ? `Warnings ${counts.warnings}` : t === "quakes" ? `Quakes ${counts.quakes}` : `Feeds ${counts.feeds}`}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search alerts" aria-label="Search alerts" style={{ ...input, flex: 1 }} />
        <button style={small} onClick={load} disabled={refreshing}>{refreshing ? "…" : "Refresh"}</button>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: muted }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={pinsOn} onChange={(e) => onTogglePins(e.target.checked)} /> Pin these reports on map</label>
        <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={warningsOn} onChange={(e) => onToggleWarnings(e.target.checked)} /> Show warnings on map</label>
      </div>
      {tab === "news" && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {(["all", "western", "russian", "regional", "independent"] as const).map((b) => (
            <button key={b} style={{ ...small, color: b === "all" ? (blocFilter === b ? text : "#9db4ff") : BLOC[b].color, background: blocFilter === b ? "rgba(124,156,255,0.18)" : "transparent" }} onClick={() => setBlocFilter(b)}>{b === "all" ? "All sources" : BLOC[b].short}</button>
          ))}
        </div>
      )}
      {errors.length > 0 && <div style={{ color: "#ff8f8f", fontSize: 11 }}>Could not load: {errors.join(", ")}.</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {tab === "all" && all.slice(0, 120).map((r) => r.el())}
        {tab === "news" && news.slice(0, 200).map(newsRow)}
        {tab === "warnings" && shownZones.map(zoneRow)}
        {tab === "quakes" && bigQuakes.map(quakeRow)}
        {tab === "feeds" && shownFeeds.map(feedRow)}
        {!alerts && !zones && errors.length === 0 && <div style={{ color: muted, fontSize: 11 }}>Loading alerts…</div>}
      </div>
      <div style={{ color: muted, fontSize: 10.5, lineHeight: 1.45 }}>
        Warnings are standing watch zones: their severity is an Afrilens editorial rating of the situation, not a live measurement. They differ from escalation alerts, which are raised only when a major event has happened in the past two days. Reports are grouped under a zone by the places they name; that groups them, it does not verify them. Telegram posts are in the Telegram tool.
      </div>
    </div>
  );
}
