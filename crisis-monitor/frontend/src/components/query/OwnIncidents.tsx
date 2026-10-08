import { useEffect, useMemo, useState } from "react";
import { api, type QueryOverview, type QueryStreamItem } from "../../api";
import { ACTOR_CATEGORIES, OTHER_CATEGORY, classifyActor } from "../actorTheme";
import { Empty, Panel } from "./shared";

/**
 * "Live incident picture": what this query is collecting right now from open sources,
 * read as incidents. Nothing here comes from your own recorded incidents or
 * from any historical table: every figure is drawn from the news reports the
 * query collected in the period shown, with the report behind each line.
 *
 * Who was involved and what happened are read from the headline and snippet by
 * keyword, so they are a quick read of the coverage, not a coded record.
 */

const ALL_CATEGORIES = [...ACTOR_CATEGORIES, OTHER_CATEGORY];

const TACTICS: { label: string; rx: RegExp }[] = [
  { label: "Armed clash / fighting", rx: /\b(clash(?:es|ed)?|fighting|firefight|battle|combat|skirmish|gunfight|offensive)\b/i },
  { label: "Attack / ambush", rx: /\b(attack(?:s|ed)?|ambush(?:ed)?|raid(?:s|ed)?|assault(?:s|ed)?|storm(?:ed|s)?)\b/i },
  { label: "Killing / shooting", rx: /\b(kill(?:s|ed|ing)?|shot dead|shooting|massacre|gunned down|slain|murder(?:ed)?)\b/i },
  { label: "Bombing / explosion", rx: /\b(bomb(?:s|ing|ed)?|explosion|blast|suicide|ied|landmine|shelling|shelled|airstrike|air strike|drone strike)\b/i },
  { label: "Kidnapping / abduction", rx: /\b(kidnap\w*|abduct\w*|hostages?|taken captive)\b/i },
  { label: "Protest / unrest", rx: /\b(protest\w*|riot\w*|demonstrat\w*|unrest|clashes with police)\b/i },
  { label: "Coup / seizure of power", rx: /\b(coup|overthrow\w*|mutiny|seize[sd]? power|junta)\b/i },
  { label: "Arson / looting", rx: /\b(arson|burn(?:ed|t)|torched|loot(?:ed|ing)?|pillag\w*)\b/i },
];

const HARM_RX = /\b(kill(?:s|ed|ing)?|dead|deaths?|died|massacre|slain|casualt\w+|wounded|injur\w+)\b/i;
const NUM_DEAD_RX = /\b(\d{1,4})\s+(?:people\s+|civilians\s+|soldiers\s+|fighters\s+|villagers\s+)?(?:were\s+)?(?:killed|dead|died|slain)\b|\b(?:killed|kills|leaves|leaving)\s+(\d{1,4})\b/i;

const text = (i: QueryStreamItem) => `${i.title} ${i.snippet ?? ""}`;
const actorOf = (i: QueryStreamItem) => classifyActor(text(i));
const tacticOf = (i: QueryStreamItem) => TACTICS.find((t) => t.rx.test(text(i)))?.label ?? null;
const deathsIn = (i: QueryStreamItem) => {
  const m = NUM_DEAD_RX.exec(text(i));
  return m ? Number(m[1] ?? m[2]) : 0;
};

function topN(items: string[], n = 5): [string, number][] {
  const m = new Map<string, number>();
  for (const k of items) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function Bars({ items, color }: { items: [string, number][]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i[1]));
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {items.map(([label, n]) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 34px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <div style={{ position: "relative", background: "var(--panel-raised)", borderRadius: 4, overflow: "hidden", height: 22 }}>
            <div style={{ position: "absolute", inset: 0, width: `${(n / max) * 100}%`, background: color, opacity: 0.28 }} />
            <span style={{ position: "relative", padding: "0 8px", lineHeight: "22px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{label}</span>
          </div>
          <b style={{ textAlign: "right" }}>{n.toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}

type Inc = { item: QueryStreamItem; actor: { label: string; color: string }; tactic: string | null; deaths: number; harm: boolean };

/** Incident reports gathered by place: the busiest places first, each with who is named and what is reported. */
function hotspotsOf(incidents: Inc[]) {
  const by = new Map<string, Inc[]>();
  for (const x of incidents) {
    const p = x.item.place?.trim();
    if (p) by.set(p, [...(by.get(p) ?? []), x]);
  }
  return [...by.entries()]
    .map(([place, rows]) => {
      const actors = topN(rows.filter((r) => r.actor !== OTHER_CATEGORY).map((r) => r.actor.label), 1)[0];
      const color = rows.find((r) => r.actor.label === actors?.[0])?.actor.color ?? OTHER_CATEGORY.color;
      return {
        place,
        n: rows.length,
        outlets: new Set(rows.map((r) => r.item.source).filter(Boolean)).size,
        actor: actors?.[0] ?? null,
        color,
        tactic: topN(rows.map((r) => r.tactic ?? ""), 1)[0]?.[0] ?? null,
        deaths: rows.reduce((a, r) => a + r.deaths, 0),
        last: rows.reduce((a, r) => (r.item.published_at > a ? r.item.published_at : a), ""),
      };
    })
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .slice(0, 8);
}

/** How many incident reports arrived in each hour (short periods) or day (longer ones). */
function pulseOf(incidents: Inc[], bucket: "day" | "hour") {
  const len = bucket === "hour" ? 13 : 10;
  const m = new Map<string, number>();
  for (const x of incidents) {
    const k = x.item.published_at.slice(0, len);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => ({ k, n }));
}

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 2880) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function OwnIncidents({ overview }: { overview: QueryOverview | null }) {
  const [items, setItems] = useState<QueryStreamItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryId = overview?.queryId;
  const from = overview?.from;
  const to = overview?.to;
  const tz = overview?.tz ?? 0;

  useEffect(() => {
    if (!queryId || !from || !to) return;
    let live = true;
    setError(null);
    api
      .getQueryStream(queryId, { from, to, tz, kind: "event", limit: 300 })
      .then((r) => live && setItems(r.items))
      .catch((err) => live && (setItems([]), setError(err instanceof Error ? err.message : "The live reports could not be read.")));
    return () => {
      live = false;
    };
  }, [queryId, from, to, tz]);

  // Only reports that read as an incident: a violent or disruptive event, not general coverage.
  const incidents = useMemo(() => {
    if (!items) return null;
    return items
      .map((i) => ({ item: i, actor: actorOf(i), tactic: tacticOf(i), deaths: deathsIn(i), harm: HARM_RX.test(text(i)) }))
      .filter((x) => x.tactic !== null || x.harm)
      .sort((a, b) => b.item.published_at.localeCompare(a.item.published_at));
  }, [items]);

  const stats = useMemo(() => {
    if (!incidents || incidents.length === 0) return null;
    const cats = new Map<string, { n: number; color: string }>();
    for (const x of incidents) {
      const cur = cats.get(x.actor.label) ?? { n: 0, color: x.actor.color };
      cur.n++;
      cats.set(x.actor.label, cur);
    }
    return {
      breakdown: ALL_CATEGORIES.map((c) => ({ label: c.label, color: c.color, n: cats.get(c.label)?.n ?? 0 })).filter((c) => c.n > 0),
      tactics: topN(incidents.map((x) => x.tactic ?? "")),
      hotspots: hotspotsOf(incidents),
      pulse: pulseOf(incidents, overview?.bucket ?? "day"),
      outlets: new Set(incidents.map((x) => x.item.source).filter(Boolean)).size,
      located: new Set(incidents.filter((x) => x.item.place).map((x) => x.item.place)).size,
      reportedDead: incidents.reduce((a, x) => a + x.deaths, 0),
    };
  }, [incidents, overview?.bucket]);

  const tile = (label: string, value: string) => (
    <div style={{ background: "var(--panel-raised)", borderRadius: 8, padding: "8px 12px", minWidth: 96 }}>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{label}</div>
    </div>
  );
  const head = (t: string) => <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", margin: "14px 0 6px" }}>{t}</div>;

  return (
    <Panel title="Live incident picture" note={incidents && items ? `${incidents.length.toLocaleString()} of ${items.length.toLocaleString()} reports read as incidents` : undefined}>
      {!overview || !incidents ? (
        <Empty>Loading…</Empty>
      ) : error ? (
        <Empty>{error}</Empty>
      ) : !stats ? (
        <Empty>No report this query collected in this period reads as an incident yet. New reports are picked up from open sources as they are published.</Empty>
      ) : (
        <div className="qd-scroll" style={{ paddingRight: 4 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tile("incident reports", incidents!.length.toLocaleString())}
            {tile("places named", stats.located.toLocaleString())}
            {tile("outlets reporting", stats.outlets.toLocaleString())}
            {stats.reportedDead > 0 && tile("deaths reported in headlines", stats.reportedDead.toLocaleString())}
          </div>

          {head("Who is named")}
          <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--panel-raised)" }}>
            {stats.breakdown.map((c) => (
              <div key={c.label} title={`${c.label}: ${c.n}`} style={{ width: `${(c.n / incidents!.length) * 100}%`, background: c.color }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", marginTop: 6, fontSize: 12 }}>
            {stats.breakdown.map((c) => (
              <span key={c.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <i style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, display: "inline-block" }} />
                {c.label} <b>{c.n}</b>
              </span>
            ))}
          </div>

          {head(overview?.bucket === "hour" ? "Pulse — incident reports per hour" : "Pulse — incident reports per day")}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 44 }}>
            {stats.pulse.map((p) => {
              const max = Math.max(...stats.pulse.map((q) => q.n));
              return <div key={p.k} title={`${p.k.replace("T", " ")}${overview?.bucket === "hour" ? ":00" : ""} — ${p.n}`} style={{ flex: 1, minWidth: 2, height: `${Math.max(8, (p.n / max) * 100)}%`, background: "#e34948", opacity: 0.75, borderRadius: 2 }} />;
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 18 }}>
            <div>
              {head("What is being reported")}
              {stats.tactics.length > 0 ? <Bars items={stats.tactics} color="#e34948" /> : <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No clear event type.</div>}
            </div>
          </div>

          {head("Hotspots")}
          {stats.hotspots.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No place named in these reports yet.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
              {stats.hotspots.map((h) => (
                <div key={h.place} style={{ background: "var(--panel-raised)", borderRadius: 8, padding: "8px 10px", borderLeft: `4px solid ${h.color}`, fontSize: 12.5, lineHeight: 1.4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.place}</b>
                    <b>{h.n}</b>
                  </div>
                  <div style={{ color: "var(--text-faint)" }}>
                    {[h.actor, h.tactic].filter(Boolean).join(" · ") || "Actor and type unclear"}
                  </div>
                  <div style={{ color: "var(--text-faint)" }}>
                    {h.outlets} outlet{h.outlets === 1 ? "" : "s"}{h.deaths ? ` · ${h.deaths} dead reported` : ""} · {ago(h.last)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
