import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, type SituationEvent } from "../api";
import { chip, muted, select, tag, text } from "./panelUi";

/**
 * The Events tool: humanitarian and political events of the last week, most serious first. These come from
 * articles the incident pipeline read and found were not armed conflict, so they never raise an escalation level.
 */
const SEV_COLOUR = { 3: "#ff6b6b", 2: "#ffb020", 1: "#93a1b8" } as const;
const CAT_COLOUR = { humanitarian: "#38bdf8", political: "#e879f9" } as const;
const num = (n: number) => n.toLocaleString("en-GB");

function ago(day: string): string {
  const days = Math.round((Date.now() - Date.parse(`${day}T12:00:00Z`)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

export default function SituationPanel() {
  const [events, setEvents] = useState<SituationEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<"all" | "humanitarian" | "political">("all");
  const [minSeverity, setMinSeverity] = useState<1 | 2 | 3>(2);
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getSituationEvents(days)
        .then((r) => !cancelled && (setEvents(r.events), setError(null)))
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Events unavailable"));
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [days]);

  const shown = useMemo(() => (events ?? []).filter((e) => (category === "all" || e.category === category) && e.severity >= minSeverity), [events, category, minSeverity]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, color: text, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["all", "humanitarian", "political"] as const).map((c) => (
          <button key={c} style={chip(category === c)} aria-pressed={category === c} onClick={() => setCategory(c)}>{c === "all" ? "All" : c === "humanitarian" ? "Humanitarian" : "Political"}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {([3, 2, 1] as const).map((s) => (
          <button key={s} style={chip(minSeverity === s)} aria-pressed={minSeverity === s} onClick={() => setMinSeverity(s)}>{s === 1 ? "All levels" : `S${s}${s === 2 ? " and up" : " only"}`}</button>
        ))}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" style={select}>
          <option value={3}>Last 3 days</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      {error && <div style={{ color: "#ff8f8f", fontSize: 11 }}>Could not load events: {error}</div>}
      {!events && !error && <div style={{ color: muted, fontSize: 11 }}>Loading events…</div>}
      {events && shown.length === 0 && (
        <div style={{ color: muted, fontSize: 11, lineHeight: 1.5 }}>
          {events.length === 0 ? "No events recorded yet. They build up as articles are read, so the list fills over the first day after the update." : "Nothing at this level in this period. Try “All levels”."}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((e) => (
          <div key={e.id} style={{ padding: "9px 0", borderBottom: "1px solid rgba(124,156,255,0.12)" }}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
              <span style={tag(SEV_COLOUR[e.severity])}>S{e.severity}</span>
              <span style={tag(CAT_COLOUR[e.category])}>{e.typeLabel}</span>
              <span style={{ color: muted, fontSize: 10.5 }}>{e.place ? `${e.place}, ` : ""}{e.countryName} · {ago(e.lastDate)}</span>
            </div>
            <div style={{ lineHeight: 1.45 }}>{e.summary}</div>
            <div style={{ color: muted, fontSize: 10.5, marginTop: 3 }}>
              {e.deaths ? `${num(e.deaths)} deaths · ` : ""}
              {e.affected ? `${num(e.affected)} people affected · ` : ""}
              {e.confidence === "confirmed" ? `${e.outlets} outlets` : "single source"}
              {" · "}
              <button onClick={() => setOpen(open === e.id ? null : e.id)} style={{ background: "none", border: 0, padding: 0, color: "#9db4ff", cursor: "pointer", fontFamily: "inherit", fontSize: 10.5 }}>
                {open === e.id ? "Hide sources" : `Sources (${e.sources.length})`}
              </button>
            </div>
            {open === e.id && (
              <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ color: muted, fontSize: 10.5, fontStyle: "italic" }}>“{e.quote}”</div>
                {e.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" style={{ color: "#9db4ff", fontSize: 11, textDecoration: "none", lineHeight: 1.4 }}>
                    {s.title} <span style={{ color: muted }}>({s.domain})</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: muted, lineHeight: 1.45 }}>
        S3: 25 or more deaths, 100,000 or more people affected, or a change of government. S2: any deaths, 10,000 or more affected, or unrest, an election, a crackdown, an outbreak, aid blocked, a diplomatic rupture or peace talks. These are kept apart from conflict escalation and never raise an incident's level.
      </div>
    </div>
  );
}
