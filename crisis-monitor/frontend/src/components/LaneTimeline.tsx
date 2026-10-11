import { useMemo, useRef, useState, type ReactNode } from "react";
import { useInView } from "../lib/motion";

/**
 * A timeline with one lane per category. Each event is a marker on its lane,
 * placed by date; markers on the same day stack. Reference lines mark key
 * dates across every lane. Hover or select a marker to read it in the panel
 * below. Markers rise in one after another when the timeline scrolls into view.
 */

export interface LaneDef {
  key: string;
  label: string;
  color: string;
}

export interface LaneEvent {
  id: string;
  lane: string;
  date: string; // YYYY-MM-DD
  title: string;
  color?: string;
  detail?: ReactNode;
}

export interface RefLine {
  date: string;
  label: string;
}

const LABEL_W = 176;
const ROW_H = 46;
const STACK = 9;

export function LaneTimeline({
  lanes,
  events,
  start,
  end,
  label,
  marks = [],
  today,
  picked,
  onPick,
  empty = "Nothing to show for this period.",
}: {
  lanes: LaneDef[];
  events: LaneEvent[];
  start: string;
  end: string;
  label: string;
  marks?: RefLine[];
  today?: string;
  picked?: string | null;
  onPick?: (id: string) => void;
  empty?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.15);
  const [hi, setHi] = useState<string | null>(null);
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const t1 = Date.parse(`${end}T00:00:00Z`);
  const at = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(`${iso}T00:00:00Z`) - t0) / Math.max(1, t1 - t0)) * 100));

  const ticks = useMemo(() => {
    const out: { p: number; label: string; year: boolean }[] = [];
    const d = new Date(t0);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    // Quarter starts only, so the labels never collide; January carries the year.
    while (d.getTime() <= t1) {
      const m = d.getUTCMonth();
      if (m % 3 === 0) {
        out.push({
          p: ((d.getTime() - t0) / (t1 - t0)) * 100,
          label: m === 0 ? d.toLocaleDateString("en-GB", { year: "numeric", timeZone: "UTC" }) : d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
          year: m === 0,
        });
      }
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  }, [t0, t1]);

  // Stack same-day markers in a lane: each gets a vertical offset from the lane's centre line.
  const offsets = useMemo(() => {
    const groups = new Map<string, LaneEvent[]>();
    events.forEach((e) => {
      const k = `${e.lane}|${e.date}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    });
    const out = new Map<string, number>();
    groups.forEach((g) => g.forEach((e, i) => out.set(e.id, (i - (g.length - 1) / 2) * STACK)));
    return out;
  }, [events]);

  const active = events.find((e) => e.id === (hi ?? picked)) ?? null;
  const activeLane = active ? lanes.find((l) => l.key === active.lane) : undefined;
  const counts = lanes.map((l) => events.filter((e) => e.lane === l.key).length);
  const trackH = lanes.length * ROW_H;

  return (
    <div ref={ref} className={`ltl ${seen ? "is-in" : ""}`} role="group" aria-label={label}>
      {events.length === 0 && <p className="ltl__empty">{empty}</p>}
      <div className="ltl__scroll">
        <div className="ltl__inner">
          <div className="ltl__head" style={{ marginLeft: LABEL_W }}>
            {marks.map((m) => (
              <span key={m.date} className={`ltl__mark-label ${at(m.date) > 88 ? "is-end" : ""}`} style={{ left: `${at(m.date)}%` }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="ltl__body">
            <div className="ltl__lanes">
              {lanes.map((l, li) => (
                <div key={l.key} className="ltl__lane" style={{ height: ROW_H }}>
                  <div className="ltl__name" style={{ width: LABEL_W }}>
                    <i style={{ background: l.color }} aria-hidden="true" />
                    <span>{l.label}</span>
                    <small>{counts[li]}</small>
                  </div>
                  <div className="ltl__track" style={{ animationDelay: `${li * 80}ms` }} />
                </div>
              ))}
            </div>
            <div className="ltl__plot" style={{ left: LABEL_W, height: trackH }}>
              {marks.map((m, i) => (
                <span key={m.date} className="ltl__mark" style={{ left: `${at(m.date)}%`, transitionDelay: `${200 + i * 120}ms` }} />
              ))}
              {today && <span className="ltl__today" style={{ left: `${at(today)}%` }} />}
              {events.map((e, i) => {
                const li = lanes.findIndex((l) => l.key === e.lane);
                if (li < 0) return null;
                const on = (hi ?? picked) === e.id;
                const color = e.color ?? lanes[li].color;
                const off = offsets.get(e.id) ?? 0;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`ltl__dot ${on ? "is-on" : ""}`}
                    style={{
                      left: `${at(e.date)}%`,
                      top: li * ROW_H + ROW_H / 2 + off,
                      background: color,
                      transitionDelay: `${300 + i * 35}ms`,
                    }}
                    onMouseEnter={() => setHi(e.id)}
                    onMouseLeave={() => setHi(null)}
                    onFocus={() => setHi(e.id)}
                    onBlur={() => setHi(null)}
                    onClick={() => onPick?.(e.id)}
                    aria-label={`${new Date(`${e.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}: ${e.title}`}
                  />
                );
              })}
            </div>
          </div>
          <div className="ltl__axis" style={{ marginLeft: LABEL_W }}>
            {ticks.map((t) => (
              <span key={t.p} className={`ltl__tick ${t.year ? "is-year" : ""} ${t.p < 4 ? "is-start" : ""} ${t.p > 95 ? "is-end" : ""}`} style={{ left: `${t.p}%` }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="ltl__detail" aria-live="polite">
        {active ? (
          <>
            <p className="ltl__when">
              <span style={{ color: activeLane?.color ?? active.color }}>{activeLane?.label}</span>
              {" · "}
              {new Date(`${active.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
            </p>
            <h4>{active.title}</h4>
            {active.detail && <div className="ltl__body-text">{active.detail}</div>}
          </>
        ) : (
          <p className="ltl__hint">Hover or select a marker to read it.</p>
        )}
      </div>
    </div>
  );
}
