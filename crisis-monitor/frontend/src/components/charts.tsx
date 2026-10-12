import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useInView } from "../lib/motion";

/**
 * Shared charts for the election and conflict dashboards. Every chart draws in
 * when it scrolls into view, and every mark responds to the pointer and to the
 * keyboard: the mark lifts or brightens, the rest step back, and a readout
 * shows the value. Colours and labels are passed in, so each dashboard keeps
 * its own meaning for them.
 */

export interface Datum {
  key?: string;
  label: string;
  value: number;
  color?: string;
  sub?: string;
}

const pct = (n: number, max: number) => `${Math.max(0, (n / Math.max(1, max)) * 100)}%`;
const fmtDefault = (n: number) => n.toLocaleString("en-GB");

/* ── vertical bars ────────────────────────────────────────── */

export function VBars({ data, height = 180, fmt = fmtDefault, label, valueAlways = false, selected, onPick }: { data: Datum[]; height?: number; fmt?: (n: number) => string; label: string; valueAlways?: boolean; selected?: string | null; onPick?: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div ref={ref} className="vz-vbars" style={{ height }} role="group" aria-label={label}>
      {data.map((d, i) => (
        <div
          key={`${d.label}-${i}`}
          className={`vz-vbar ${hi === i ? "is-hi" : hi !== null ? "is-dim" : ""} ${selected && selected === (d.key ?? d.label) ? "is-sel" : ""} ${onPick ? "is-click" : ""}`}
          tabIndex={0}
          onMouseEnter={() => setHi(i)}
          onMouseLeave={() => setHi(null)}
          onFocus={() => setHi(i)}
          onBlur={() => setHi(null)}
          onClick={() => onPick?.(d.key ?? d.label)}
          onKeyDown={(e) => e.key === "Enter" && onPick?.(d.key ?? d.label)}
          aria-pressed={onPick ? selected === (d.key ?? d.label) : undefined}
          aria-label={`${d.label}: ${fmt(d.value)}${d.sub ? `, ${d.sub}` : ""}`}
        >
          <span className="vz-vbar__val">{hi === i || valueAlways ? fmt(d.value) : ""}</span>
          <span className="vz-vbar__track">
            <span className="vz-vbar__fill" style={{ height: seen ? pct(d.value, max) : "0%", background: d.color ?? "var(--info)", transitionDelay: `${i * 45}ms` }} />
          </span>
          <span className="vz-vbar__lab">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── horizontal bars ──────────────────────────────────────── */

export function HBars({ data, fmt = fmtDefault, label, max: maxOverride, note }: { data: Datum[]; fmt?: (n: number) => string; label: string; max?: number; note?: (d: Datum) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<number | null>(null);
  const max = maxOverride ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div ref={ref} className="vz-hbars" role="group" aria-label={label}>
      {data.map((d, i) => (
        <div
          key={`${d.label}-${i}`}
          className={`vz-hbar ${hi === i ? "is-hi" : hi !== null ? "is-dim" : ""}`}
          tabIndex={0}
          onMouseEnter={() => setHi(i)}
          onMouseLeave={() => setHi(null)}
          onFocus={() => setHi(i)}
          onBlur={() => setHi(null)}
          aria-label={`${d.label}: ${fmt(d.value)}`}
        >
          <span className="vz-hbar__lab">{d.label}{d.sub && <small>{d.sub}</small>}</span>
          <span className="vz-hbar__track">
            <span className="vz-hbar__fill" style={{ width: seen ? pct(d.value, max) : "0%", background: d.color ?? "var(--info)", transitionDelay: `${i * 35}ms` }} />
          </span>
          <span className="vz-hbar__val">{fmt(d.value)}</span>
          {hi === i && note && <span className="vz-hbar__note">{note(d)}</span>}
        </div>
      ))}
    </div>
  );
}

/* ── stacked columns (weekly counts by type) ──────────────── */

export interface StackColumn {
  label: string;
  segments: { key: string; label: string; value: number; color: string }[];
}

export function StackedColumns({ columns, height = 200, label, unit = "events" }: { columns: StackColumn[]; height?: number; label: string; unit?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<number | null>(null);
  const totals = columns.map((c) => c.segments.reduce((a, s) => a + s.value, 0));
  const max = Math.max(1, ...totals);
  return (
    <div ref={ref} className="vz-stack" style={{ height }} role="group" aria-label={label}>
      {columns.map((c, i) => {
        const t = totals[i];
        return (
          <div key={c.label + i} className={`vz-stack__col ${hi === i ? "is-hi" : hi !== null ? "is-dim" : ""}`} tabIndex={0} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onFocus={() => setHi(i)} onBlur={() => setHi(null)} aria-label={`${c.label}: ${t} ${unit}`}>
            <span className="vz-stack__n">{hi === i ? t : t || ""}</span>
            <span className="vz-stack__bar" style={{ height: seen ? pct(t, max) : "0%", transitionDelay: `${i * 30}ms` }}>
              {c.segments.map((s) =>
                s.value > 0 ? <span key={s.key} className="vz-stack__seg" style={{ flex: s.value, background: s.color }} /> : null,
              )}
            </span>
            <span className="vz-stack__lab">{c.label}</span>
            {hi === i && (
              <span className="vz-tip vz-tip--stack" role="status">
                <b>{c.label}</b>
                {c.segments.filter((s) => s.value > 0).map((s) => (
                  <span key={s.key}><i style={{ background: s.color }} />{s.label} <strong>{s.value}</strong></span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── donut ────────────────────────────────────────────────── */

export function Donut({ slices, label, centre, size = 180, fmt = fmtDefault, selected, onPick }: { slices: Datum[]; label: string; centre?: ReactNode; size?: number; fmt?: (n: number) => string; selected?: string | null; onPick?: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<number | null>(null);
  const total = Math.max(1, slices.reduce((a, s) => a + s.value, 0));
  const R = 70;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const hovered = hi !== null ? slices[hi] : null;
  return (
    <div ref={ref} className="vz-donut" role="group" aria-label={label}>
      <div className="vz-donut__ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 180 180" width={size} height={size} className="vz-donut__svg">
        <circle cx="90" cy="90" r={R} className="vz-donut__track" />
        {slices.map((s, i) => {
          const frac = s.value / total;
          const len = frac * C;
          const off = -acc * C;
          acc += frac;
          return (
            <circle
              key={s.label + i}
              cx="90"
              cy="90"
              r={R}
              className={`vz-donut__seg ${hi === i ? "is-hi" : hi !== null ? "is-dim" : ""}`}
              stroke={s.color ?? "var(--info)"}
              strokeDasharray={seen ? `${Math.max(0, len - 1.5)} ${C}` : `0 ${C}`}
              strokeDashoffset={off}
              style={{ transitionDelay: `${i * 90}ms` }}
              onMouseEnter={() => setHi(i)}
              onMouseLeave={() => setHi(null)}
              onFocus={() => setHi(i)}
              onBlur={() => setHi(null)}
              tabIndex={0}
              aria-label={`${s.label}: ${fmt(s.value)}`}
            />
          );
        })}
      </svg>
      <div className="vz-donut__centre">
        {hovered ? (
          <>
            <strong>{fmt(hovered.value)}</strong>
            <span>{hovered.label}</span>
            <small>{Math.round((hovered.value / total) * 100)}%</small>
          </>
        ) : (
          centre
        )}
      </div>
      </div>
      <ul className="vz-donut__legend">
        {slices.map((s, i) => (
          <li key={s.label + i} className={`${hi === i ? "is-hi" : hi !== null ? "is-dim" : ""} ${selected && selected === (s.key ?? s.label) ? "is-sel" : ""} ${onPick ? "is-click" : ""}`} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onClick={() => onPick?.(s.key ?? s.label)}>
            <i style={{ background: s.color ?? "var(--info)" }} />
            <span>{s.label}</span>
            <strong>{fmt(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SunGroup {
  label: string;
  color: string;
  children: Datum[];
}

/** Two rings: families of categories on the inner ring, the categories themselves on the outer. Each arc is a stroked circle, so it draws in and reacts to hover like the donut. */
export function Sunburst({ groups, label, centre, size = 210, fmt = fmtDefault, selected, onPick }: { groups: SunGroup[]; label: string; centre?: ReactNode; size?: number; fmt?: (n: number) => string; selected?: string | null; onPick?: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<{ g: number; c: number | null } | null>(null);
  const sum = (ds: Datum[]) => ds.reduce((a, d) => a + d.value, 0);
  const total = Math.max(1, sum(groups.flatMap((g) => g.children)));
  const VB = 252;
  const RI = 58;
  const RO = 108;
  const W = 36;
  const CI = 2 * Math.PI * RI;
  const CO = 2 * Math.PI * RO;
  let acc = 0;
  const arcs = groups.map((g, gi) => {
    const gv = sum(g.children);
    const gStart = acc;
    acc += gv / total;
    // Outer arcs are laid out from the same start, so each child sits inside its family.
    let kStart = gStart;
    const kids = g.children.map((c, ci) => {
      const frac = c.value / total;
      const out = { c, ci, start: kStart, frac };
      kStart += frac;
      return out;
    });
    return { g, gi, gv, gStart, frac: gv / total, kids };
  });
  const hovered = hi === null ? null : hi.c === null ? { label: groups[hi.g].label, value: arcs[hi.g].gv } : { label: groups[hi.g].children[hi.c].label, value: groups[hi.g].children[hi.c].value };
  const dimmedInner = (gi: number) => (hi !== null && !(hi.g === gi) ? "is-dim" : hi !== null && hi.g === gi ? "is-hi" : "");
  const dimmedOuter = (gi: number, ci: number) => {
    if (hi === null) return "";
    const on = hi.g === gi && (hi.c === null || hi.c === ci);
    return on ? "is-hi" : "is-dim";
  };
  const renderArc = (a: (typeof arcs)[number]) => (
        <Fragment key={a.g.label}>
          <li className={`vz-sun__group ${hi !== null && hi.g === a.gi && hi.c === null ? "is-hi" : hi !== null && hi.g !== a.gi ? "is-dim" : ""}`} onMouseEnter={() => setHi({ g: a.gi, c: null })} onMouseLeave={() => setHi(null)}>
            <i style={{ background: a.g.color }} />
            <span>{a.g.label}</span>
            <strong>{fmt(a.gv)}</strong>
          </li>
          {a.kids.map((k) => (
            <li
              key={k.c.key ?? k.c.label}
              className={`vz-sun__kid ${dimmedOuter(a.gi, k.ci) === "is-hi" ? "is-hi" : dimmedOuter(a.gi, k.ci) === "is-dim" ? "is-dim" : ""} ${selected && selected === (k.c.key ?? k.c.label) ? "is-sel" : ""} ${onPick ? "is-click" : ""}`}
              onMouseEnter={() => setHi({ g: a.gi, c: k.ci })}
              onMouseLeave={() => setHi(null)}
              onClick={() => onPick?.(k.c.key ?? k.c.label)}
            >
              <i style={{ background: k.c.color ?? "var(--info)" }} />
              <span>{k.c.label}</span>
              <strong>{fmt(k.c.value)}</strong>
            </li>
          ))}
        </Fragment>
  );
  // The first groups sit beside the ring, filling about its height; the rest flow across the card below it.
  const rowBudget = Math.max(6, Math.floor(size / 21));
  let used = 0;
  let split = 0;
  for (; split < arcs.length; split++) {
    const rows = 1 + arcs[split].kids.length;
    if (split > 0 && used + rows > rowBudget) break;
    used += rows;
  }
  const headArcs = arcs.slice(0, split);
  const tailArcs = arcs.slice(split);

  return (
    <div ref={ref} className="vz-donut vz-sun" role="group" aria-label={label}>
      <div className="vz-sun__top">
      <div className="vz-donut__ring" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${VB} ${VB}`} width={size} height={size} className="vz-donut__svg">
          <circle cx={VB / 2} cy={VB / 2} r={RI} className="vz-sun__track" strokeWidth={W} />
          <circle cx={VB / 2} cy={VB / 2} r={RO} className="vz-sun__track" strokeWidth={W} />
          {arcs.map((a) => (
            <circle
              key={`g-${a.g.label}`}
              cx={VB / 2}
              cy={VB / 2}
              r={RI}
              strokeWidth={W}
              className={`vz-sun__seg ${dimmedInner(a.gi)}`}
              stroke={a.g.color}
              strokeDasharray={seen && a.frac > 0 ? `${Math.max(0, a.frac * CI - 1.5)} ${CI}` : `0 ${CI}`}
              strokeDashoffset={-a.gStart * CI}
              style={{ transitionDelay: `${a.gi * 120}ms` }}
              onMouseEnter={() => setHi({ g: a.gi, c: null })}
              onMouseLeave={() => setHi(null)}
              tabIndex={0}
              onFocus={() => setHi({ g: a.gi, c: null })}
              onBlur={() => setHi(null)}
              aria-label={`${a.g.label}: ${fmt(a.gv)}`}
            />
          ))}
          {arcs.flatMap((a) =>
            a.kids.map((k) => (
              <circle
                key={`k-${a.g.label}-${k.c.key ?? k.c.label}`}
                cx={VB / 2}
                cy={VB / 2}
                r={RO}
                strokeWidth={W}
                className={`vz-sun__seg ${dimmedOuter(a.gi, k.ci)} ${selected && selected === (k.c.key ?? k.c.label) ? "is-sel" : ""} ${onPick ? "is-click" : ""}`}
                stroke={k.c.color ?? "var(--info)"}
                strokeDasharray={seen && k.frac > 0 ? `${Math.max(0, k.frac * CO - 1.5)} ${CO}` : `0 ${CO}`}
                strokeDashoffset={-k.start * CO}
                style={{ transitionDelay: `${240 + k.ci * 70}ms` }}
                onMouseEnter={() => setHi({ g: a.gi, c: k.ci })}
                onMouseLeave={() => setHi(null)}
                onFocus={() => setHi({ g: a.gi, c: k.ci })}
                onBlur={() => setHi(null)}
                onClick={() => onPick?.(k.c.key ?? k.c.label)}
                tabIndex={0}
                aria-label={`${k.c.label}: ${fmt(k.c.value)}`}
              />
            )),
          )}
        </svg>
        <div className="vz-donut__centre">
          {hovered ? (
            <>
              <strong>{fmt(hovered.value)}</strong>
              <span>{hovered.label}</span>
              <small>{Math.round((hovered.value / total) * 100)}%</small>
            </>
          ) : (
            centre
          )}
        </div>
      </div>
      <ul className="vz-donut__legend vz-sun__legend vz-sun__head">
        {headArcs.map(renderArc)}
      </ul>
      </div>
      {tailArcs.length > 0 && (
        <ul className="vz-donut__legend vz-sun__legend vz-sun__tail">
          {tailArcs.map(renderArc)}
        </ul>
      )}
    </div>
  );
}

/* ── line with area and crosshair ─────────────────────────── */

export function LineArea({ points, label, fmt = fmtDefault, height = 180, current, color = "var(--info)" }: { points: { label: string; value: number }[]; label: string; fmt?: (n: number) => string; height?: number; current?: number; color?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = points.length ? `${d} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z` : "";
  const focus = hi ?? current ?? null;
  const onMove = (e: { currentTarget: SVGSVGElement; clientX: number }) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad) / (W - pad * 2)) * Math.max(0, points.length - 1));
    setHi(Math.min(points.length - 1, Math.max(0, i)));
  };
  const fp = focus !== null ? points[focus] : null;
  return (
    <div ref={ref} className="vz-line" role="group" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className="vz-line__svg" onMouseMove={onMove} onMouseLeave={() => setHi(null)} onTouchMove={(e) => onMove({ currentTarget: e.currentTarget, clientX: e.touches[0].clientX })} role="img" aria-label={label}>
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="vz-axis" />
        <path d={area} className={`vz-line__area ${seen ? "is-in" : ""}`} fill={color} />
        <path d={d} pathLength={1} className={`vz-line__path ${seen ? "is-drawn" : ""}`} stroke={color} fill="none" />
        {focus !== null && <line x1={x(focus)} x2={x(focus)} y1={pad / 2} y2={H - pad} className="vz-cross" />}
        {points.map((p, i) => (
          <g key={p.label + i}>
            <circle cx={x(i)} cy={y(p.value)} r={focus === i ? 6 : 3.5} className={`vz-line__dot ${focus === i ? "is-on" : ""}`} stroke={color} />
            {i % Math.ceil(points.length / 8) === 0 || i === points.length - 1 ? <text x={x(i)} y={H - 6} textAnchor="middle" className="vz-axis-lab">{p.label}</text> : null}
          </g>
        ))}
      </svg>
      {fp && focus !== null && (
        <div className="vz-line__tip" style={{ left: `${(x(focus) / W) * 100}%` }}>
          <b>{fp.label}</b> <strong>{fmt(fp.value)}</strong>
        </div>
      )}
    </div>
  );
}

/* ── one stacked bar: shares of a whole ───────────────────── */

export function StackBar({ segments, label, fmt = fmtDefault }: { segments: Datum[]; label: string; fmt?: (n: number) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<number | null>(null);
  const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  return (
    <div ref={ref} className="vz-sbar" role="group" aria-label={label}>
      <div className="vz-sbar__bar">
        {segments.map((s, i) => (
          <span
            key={s.label + i}
            tabIndex={0}
            className={`vz-sbar__seg ${hi === i ? "is-hi" : hi !== null ? "is-dim" : ""}`}
            style={{ width: seen ? `${(s.value / total) * 100}%` : "0%", background: s.color ?? "var(--info)", transitionDelay: `${i * 60}ms` }}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(null)}
            onFocus={() => setHi(i)}
            onBlur={() => setHi(null)}
            aria-label={`${s.label}: ${fmt(s.value)}`}
          />
        ))}
      </div>
      <ul className="vz-sbar__legend">
        {segments.map((s, i) => (
          <li key={s.label + i} className={hi === i ? "is-hi" : hi !== null ? "is-dim" : ""} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            <i style={{ background: s.color ?? "var(--info)" }} /> {s.label} <strong>{fmt(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── timeline: dated events on an axis ────────────────────── */

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  color?: string;
  detail?: ReactNode;
  key?: boolean;
}

export interface TimelinePhase {
  from: string;
  to: string;
  label: string;
  tone?: string;
}

/**
 * A dated timeline. Phases draw as bands under the axis, key events as cards
 * on two sides with leader stems (placed in levels so labels do not collide),
 * every event as a dot, and today as a pulsing marker. Hovering or focusing an
 * event reads its detail below. Everything animates in once on screen.
 */
const TL = { axis: 190, card: 44, gap: 52, band: 14, lead: 40, stage: 408, cardW: 164, minGap: 21 };

export function Timeline({ events, start, end, label, today, onPick, picked, phases = [] }: { events: TimelineEvent[]; start: string; end: string; label: string; today?: string; onPick?: (id: string) => void; picked?: string | null; phases?: TimelinePhase[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.15);
  const [hi, setHi] = useState<string | null>(null);
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const t1 = Date.parse(`${end}T00:00:00Z`);
  const at = (iso: string) => ((Date.parse(`${iso}T00:00:00Z`) - t0) / Math.max(1, t1 - t0)) * 100;
  const ticks = useMemo(() => {
    const out: { p: number; label: string; year: boolean }[] = [];
    const d = new Date(t0);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() <= t1) {
      const m = d.getUTCMonth();
      out.push({ p: ((d.getTime() - t0) / (t1 - t0)) * 100, label: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), year: m === 0 });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  }, [t0, t1]);
  // Key events take turns above and below the axis; a label that would collide moves to the next level.
  const slots = useMemo(() => {
    const keys = events.filter((e) => e.key).sort((a, b) => a.date.localeCompare(b.date));
    const used: number[][] = [
      [-Infinity, -Infinity, -Infinity],
      [-Infinity, -Infinity, -Infinity],
    ];
    const out = new Map<string, { side: 0 | 1; level: number }>();
    keys.forEach((e, i) => {
      const x = ((Date.parse(`${e.date}T00:00:00Z`) - t0) / Math.max(1, t1 - t0)) * 100;
      const pref = (i % 2) as 0 | 1;
      let placed = false;
      for (const side of [pref, (1 - pref) as 0 | 1]) {
        for (let L = 0; L < 3 && !placed; L++) {
          if (x - used[side][L] >= TL.minGap) {
            used[side][L] = x;
            out.set(e.id, { side, level: L });
            placed = true;
          }
        }
        if (placed) break;
      }
      if (!placed) out.set(e.id, { side: pref, level: 2 });
    });
    return out;
  }, [events, t0, t1]);
  const active = events.find((e) => e.id === (hi ?? picked)) ?? null;
  // With no key events there are no cards, so the axis sits high and the stage is short.
  const compact = slots.size === 0;
  const axisY = compact ? 62 : TL.axis;
  const stageH = compact ? axisY + 84 : TL.stage;
  // Cards never sit on the axis: each one hangs off a visible leader line.
  const cardTop = (side: 0 | 1, L: number) => (side === 0 ? axisY - TL.lead - L * TL.gap - TL.card : axisY + 70 + L * TL.gap);
  return (
    <div ref={ref} className={`vzt ${seen ? "is-in" : ""}`} role="group" aria-label={label}>
      <div className="vzt__scroll">
        <div className="vzt__stage" style={{ height: stageH }}>
          {today && (
            <div className={`vzt__today ${at(today) > 84 ? "is-end" : ""}`} style={{ left: `${at(today)}%` }}>
              <span>Today</span>
            </div>
          )}
          <div className="vzt__axis" style={{ top: axisY }} />
          {phases.map((p, i) => (
            <div
              key={p.label}
              className="vzt__phase"
              style={{ top: axisY + TL.band, left: `${at(p.from)}%`, width: `${at(p.to) - at(p.from)}%`, background: p.tone ?? "var(--info)", transitionDelay: `${250 + i * 140}ms` }}
            >
              <span>{p.label}</span>
            </div>
          ))}
          {ticks.map((t) => (
            <span key={t.label + t.p} className={`vzt__tick ${t.year ? "is-year" : ""}`} style={{ left: `${t.p}%`, top: axisY + TL.band + 30 }}>
              {t.label}
            </span>
          ))}
          {events.map((e, i) => {
            const x = at(e.date);
            const slot = slots.get(e.id);
            const on = (hi ?? picked) === e.id;
            const color = e.color ?? "var(--info)";
            const delay = `${300 + i * 45}ms`;
            return (
              <Fragment key={e.id}>
                {slot && (
                  <>
                    <span
                      className={`vzt__stem ${slot.side === 0 ? "is-up" : "is-down"}`}
                      style={{
                        left: `${x}%`,
                        top: slot.side === 0 ? cardTop(0, slot.level) + TL.card : axisY,
                        height: slot.side === 0 ? axisY - (cardTop(0, slot.level) + TL.card) : cardTop(1, slot.level) - axisY,
                        background: color,
                        transitionDelay: delay,
                      }}
                    />
                    <button
                      type="button"
                      className={`vzt__card ${x < 12 ? "is-left" : x > 88 ? "is-right" : ""} ${on ? "is-on" : ""}`}
                      style={{ left: `${x}%`, top: cardTop(slot.side, slot.level), borderColor: color, transitionDelay: delay }}
                      onMouseEnter={() => setHi(e.id)}
                      onMouseLeave={() => setHi(null)}
                      onFocus={() => setHi(e.id)}
                      onBlur={() => setHi(null)}
                      onClick={() => onPick?.(e.id)}
                    >
                      <small style={{ color }}>{new Date(`${e.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</small>
                      <b>{e.title}</b>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={`vzt__dot ${e.key ? "is-key" : ""} ${on ? "is-on" : ""}`}
                  style={{ left: `${x}%`, top: axisY, background: color, transitionDelay: delay }}
                  onMouseEnter={() => setHi(e.id)}
                  onMouseLeave={() => setHi(null)}
                  onFocus={() => setHi(e.id)}
                  onBlur={() => setHi(null)}
                  onClick={() => onPick?.(e.id)}
                  aria-label={`${e.date}: ${e.title}`}
                />
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="vz-tl__detail" aria-live="polite">
        {active ? (
          <>
            <p className="vz-tl__when">{new Date(`${active.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</p>
            <h4>{active.title}</h4>
            {active.detail && <div className="vz-tl__body">{active.detail}</div>}
          </>
        ) : (
          <p className="vz-muted">Hover or select an event to read it.</p>
        )}
      </div>
    </div>
  );
}

/* ── sparkline with a hover readout ───────────────────────── */

export function Spark({ values, label, color = "var(--info)", fmt = fmtDefault }: { values: number[]; label: string; color?: string; fmt?: (n: number) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  const [hi, setHi] = useState<number | null>(null);
  if (!values.length) return null;
  const W = 120;
  const H = 36;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (i: number) => (i * W) / Math.max(1, values.length - 1);
  const y = (v: number) => H - 3 - ((v - min) / Math.max(1, max - min)) * (H - 6);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const onMove = (e: { currentTarget: SVGSVGElement; clientX: number }) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHi(Math.min(values.length - 1, Math.max(0, Math.round(((e.clientX - box.left) / box.width) * (values.length - 1)))));
  };
  return (
    <div ref={ref} className="vz-spark" aria-label={label} role="img">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
        <path d={d} pathLength={1} className={`vz-spark__path ${seen ? "is-drawn" : ""}`} stroke={color} fill="none" />
        {hi !== null && <circle cx={x(hi)} cy={y(values[hi])} r={3} fill={color} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hi !== null && <span className="vz-spark__val">{fmt(values[hi])}</span>}
    </div>
  );
}

/* ── grouped horizontal bars: several series per group ────── */

export interface BarGroup {
  label: string;
  bars: { key: string; label: string; value: number; color: string; missing?: boolean }[];
}

export function GroupedHBars({ groups, label, fmt = (n: number) => `${n.toFixed(1)}%`, max }: { groups: BarGroup[]; label: string; fmt?: (n: number) => string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.15);
  const [hi, setHi] = useState<{ g: number; b: number } | null>(null);
  const maxV = max ?? Math.max(1, ...groups.flatMap((g) => g.bars.map((b) => (b.missing ? 0 : b.value))));
  return (
    <div ref={ref} className="vz-ghbars" role="group" aria-label={label}>
      {groups.map((g, gi) => (
        <div key={g.label} className="vz-ghbars__group">
          <span className="vz-ghbars__name">{g.label}</span>
          <div className="vz-ghbars__rows">
            {g.bars.map((b, bi) => {
              const on = hi !== null && hi.g === gi && hi.b === bi;
              const dim = hi !== null && !on;
              return (
                <div
                  key={b.key}
                  className={`vz-ghbar ${on ? "is-hi" : dim ? "is-dim" : ""}`}
                  tabIndex={0}
                  onMouseEnter={() => setHi({ g: gi, b: bi })}
                  onMouseLeave={() => setHi(null)}
                  onFocus={() => setHi({ g: gi, b: bi })}
                  onBlur={() => setHi(null)}
                  aria-label={`${g.label}, ${b.label}: ${b.missing ? "not asked" : fmt(b.value)}`}
                >
                  <span className="vz-ghbar__src"><i style={{ background: b.color }} />{b.label}</span>
                  <span className="vz-ghbar__track">
                    <span className="vz-ghbar__fill" style={{ width: seen && !b.missing ? pct(b.value, maxV) : "0%", background: b.color, transitionDelay: `${(gi * 3 + bi) * 35}ms` }} />
                  </span>
                  <span className="vz-ghbar__val">{b.missing ? "–" : fmt(b.value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
