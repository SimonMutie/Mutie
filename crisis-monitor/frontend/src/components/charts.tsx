import { useMemo, useRef, useState, type ReactNode } from "react";
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

export function Timeline({ events, start, end, label, today, onPick, picked }: { events: TimelineEvent[]; start: string; end: string; label: string; today?: string; onPick?: (id: string) => void; picked?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.15);
  const [hi, setHi] = useState<string | null>(null);
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const t1 = Date.parse(`${end}T00:00:00Z`);
  const at = (iso: string) => ((Date.parse(`${iso}T00:00:00Z`) - t0) / Math.max(1, t1 - t0)) * 100;
  const ticks = useMemo(() => {
    const out: { p: number; label: string }[] = [];
    const d = new Date(t0);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() <= t1) {
      out.push({ p: ((d.getTime() - t0) / (t1 - t0)) * 100, label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  }, [t0, t1]);
  const active = events.find((e) => e.id === (hi ?? picked)) ?? null;
  return (
    <div ref={ref} className="vz-tl" role="group" aria-label={label}>
      <div className="vz-tl__axis">
        <span className="vz-tl__line" style={{ transform: `scaleX(${seen ? 1 : 0})` }} />
        {today && <span className="vz-tl__today" style={{ left: `${at(today)}%` }}><span>today</span></span>}
        {ticks.map((t) => (
          <span key={t.label + t.p} className="vz-tl__tick" style={{ left: `${t.p}%` }}><span>{t.label}</span></span>
        ))}
        {events.map((e, i) => (
          <button
            key={e.id}
            type="button"
            className={`vz-tl__dot ${e.key ? "is-key" : ""} ${(hi ?? picked) === e.id ? "is-on" : ""} ${seen ? "is-in" : ""}`}
            style={{ left: `${at(e.date)}%`, background: e.color ?? "var(--info)", transitionDelay: `${300 + i * 60}ms` }}
            onMouseEnter={() => setHi(e.id)}
            onMouseLeave={() => setHi(null)}
            onFocus={() => setHi(e.id)}
            onBlur={() => setHi(null)}
            onClick={() => onPick?.(e.id)}
            aria-label={`${e.date}: ${e.title}`}
          />
        ))}
      </div>
      <div className="vz-tl__detail" aria-live="polite">
        {active ? (
          <>
            <p className="vz-tl__when">{new Date(`${active.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</p>
            <h4>{active.title}</h4>
            {active.detail && <div className="vz-tl__body">{active.detail}</div>}
          </>
        ) : (
          <p className="vz-muted">Hover or select a point on the line to read it.</p>
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
