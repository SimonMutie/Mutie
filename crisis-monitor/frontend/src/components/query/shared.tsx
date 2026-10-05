import { useEffect, useState, type ReactNode } from "react";
import type { QueryStreamItem } from "../../api";

/** Pieces every panel of the query dashboard uses: the tone colours, date
 *  formatting in the viewer's own time, the panel shell, and the item list. */

/** Tone is a polarity, so it gets the two-pole scheme with a neutral grey
 *  between: red for negative, blue for positive (a pair that stays apart for
 *  colour-blind readers, which red and green do not). */
export const TONE_COLOR = { negative: "#e34948", neutral: "#9c9a92", positive: "#2a78d6" } as const;
export const TONE_LABEL = { negative: "Negative", neutral: "Neutral", positive: "Positive" } as const;
export type Tone = keyof typeof TONE_COLOR;
export const toneOf = (score: number): Tone => (score < -0.2 ? "negative" : score > 0.2 ? "positive" : "neutral");

/** The viewer's offset from UTC, in minutes east (180 in Nairobi). */
export const viewerTz = () => -new Date().getTimezoneOffset();

/** A bucket from the server ("2026-10-05" or "2026-10-05T14", already in the viewer's time) as a label. */
export function bucketLabel(bucket: string, long: boolean | "row" = false): string {
  const [y, m, d] = bucket.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d, bucket.length > 10 ? Number(bucket.slice(11, 13)) : 12);
  // A table row: the weekday matters, the year does not, and it must stay on one line in a narrow panel.
  if (long === "row")
    return date.toLocaleString(
      undefined,
      bucket.length > 10 ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short" },
    );
  if (bucket.length > 10)
    return date.toLocaleString(undefined, long ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, long ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" });
}

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const exactTime = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const isWebUrl = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

/**
 * A dashboard panel: a header that is also the handle the panel is dragged
 * by, optional controls on its right, and a body that fills whatever size
 * the panel has been given.
 */
export function Panel({ title, note, actions, children, bodyStyle }: { title: string; note?: ReactNode; actions?: ReactNode; children: ReactNode; bodyStyle?: React.CSSProperties }) {
  return (
    <section className="panel qd-panel">
      <header className="qd-panel__head">
        <div className="qd-panel__title">
          <span className="qd-grip" aria-hidden>
            ⠿
          </span>
          <span className="eyebrow">{title}</span>
          {note && <span className="qd-panel__note">{note}</span>}
        </div>
        {/* Controls must not start a drag. */}
        {actions && (
          <div className="qd-panel__actions" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </header>
      <div className="qd-panel__body" style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

/** The "Chart | Table" switch every chart panel carries: the table holds the same numbers for anyone who cannot or would rather not read them off a picture. */
export function ViewSwitch({ view, onChange }: { view: "chart" | "table"; onChange: (v: "chart" | "table") => void }) {
  return (
    <div className="qd-seg" role="group" aria-label="Show as">
      {(["chart", "table"] as const).map((v) => (
        <button key={v} type="button" className={view === v ? "is-on" : ""} aria-pressed={view === v} onClick={() => onChange(v)}>
          {v === "chart" ? "Chart" : "Table"}
        </button>
      ))}
    </div>
  );
}

/** The size of an element, kept current as its panel is resized. The
 *  returned ref is a callback, so it also works for an element that only
 *  appears later (a chart shown once its data has loaded). */
export function useSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!node) return;
    const measure = () => setSize({ width: Math.floor(node.clientWidth), height: Math.floor(node.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, size] as const;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="qd-empty">{children}</div>;
}

/** One collected item: headline (a link when it has an address), the text, and where, when and from whom. */
export function StreamItem({ item, highlight }: { item: QueryStreamItem; highlight?: string }) {
  const tone = item.tone ?? toneOf(item.sentiment);
  return (
    <article className="qd-item">
      <div className="qd-item__meta">
        <span className={`qd-kind qd-kind--${item.kind}`}>{item.kind === "event" ? "Event" : "Conversation"}</span>
        <time dateTime={item.published_at} title={exactTime(item.published_at)}>
          {timeAgo(item.published_at)}
        </time>
        {item.source && <span>{item.source}</span>}
        {item.place && <span>{item.place}</span>}
        <span className="qd-tone" title={`Tone of the wording: ${TONE_LABEL[tone].toLowerCase()} (${item.sentiment.toFixed(2)}). An estimate from the words used.`}>
          <i style={{ background: TONE_COLOR[tone] }} />
          {TONE_LABEL[tone]}
        </span>
      </div>
      <h4 className="qd-item__title">
        {isWebUrl(item.url) ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            <Marked text={item.title} term={highlight} /> ↗
          </a>
        ) : (
          <Marked text={item.title} term={highlight} />
        )}
      </h4>
      {item.snippet && item.snippet.toLowerCase() !== item.title.toLowerCase() && (
        <p className="qd-item__text">
          <Marked text={item.snippet} term={highlight} />
        </p>
      )}
    </article>
  );
}

/** Text with a searched word or phrase marked where it occurs. */
function Marked({ text, term }: { text: string; term?: string }) {
  const t = term?.trim();
  if (!t) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = t.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i >= 0 && parts.length < 40; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
