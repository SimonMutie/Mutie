import { POSTS, SOURCES, type Holder } from "../data/southSudanElection";
import type { SsLive } from "../data/southSudanLive";

/**
 * The musical chairs: every post as a row, every holder as a bar from the
 * date they took it to the date they left, on one shared timeline. A bar with
 * a dashed edge has a boundary the sources do not give; it is drawn to the
 * edge of the chart, never guessed. Decrees are marked on the axis. The same
 * facts are listed in date order below the chart for anyone reading it by ear.
 */

const START = Date.parse("2024-12-01");
const END = Date.parse("2026-10-31");
const DAY = 86_400_000;
const span = END - START;
const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - START) / span) * 100))}%`;
const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const HOW: Record<Holder["how"], string> = { appointed: "Appointed", reinstated: "Reinstated", reappointed: "Reappointed", acting: "Acting", dismissed: "Dismissed", detained: "Detained" };
const QUARTERS = ["2025-01-01", "2025-04-01", "2025-07-01", "2025-10-01", "2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"];

/** Packs holders into the fewest sub-lanes where no two bars overlap. */
function lanesFor(hs: Holder[]): { h: Holder; lane: number; from: number; to: number }[] {
  const rows = hs
    .map((h) => ({ h, from: h.from ? Date.parse(h.from) : START, to: h.to ? Date.parse(h.to) : END }))
    .sort((a, b) => a.from - b.from);
  const ends: number[] = [];
  return rows.map((r) => {
    let lane = ends.findIndex((e) => e <= r.from);
    if (lane < 0) {
      lane = ends.length;
      ends.push(r.to);
    } else ends[lane] = r.to;
    return { ...r, lane };
  });
}

export default function GovernmentChanges({ live }: { live: SsLive }) {
  const byPost = POSTS.map((p) => ({ post: p, items: lanesFor(live.offices.filter((h) => h.post === p.id)) }));
  const decrees = [...new Set(live.offices.filter((h) => h.from || h.to).flatMap((h) => [h.from, h.to]).filter((d): d is string => !!d && Date.parse(d) >= START))].sort();
  const changes = [...live.offices].sort((a, b) => (a.from ?? a.to ?? "").localeCompare(b.from ?? b.to ?? ""));

  return (
    <div className="ss-gov">
      <div className="ss-gov__chart" role="img" aria-label="Chart of office holders by post, December 2024 to October 2026">
        <div className="ss-gov__axis" aria-hidden="true">
          {QUARTERS.map((q) => (
            <span key={q} style={{ left: pct(Date.parse(q)) }}>{new Date(`${q}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}</span>
          ))}
        </div>
        {byPost.map(({ post, items }) => {
          const lanes = Math.max(1, ...items.map((i) => i.lane + 1));
          return (
            <div key={post.id} className="ss-gov__row">
              <div className="ss-gov__label">
                <b>{post.label}</b>
                {items.length === 0 && <small>Nothing recorded</small>}
              </div>
              <div className="ss-gov__track" style={{ height: lanes * 30 + 8 }}>
                {decrees.map((d) => (
                  <i key={d} className="ss-gov__mark" style={{ left: pct(Date.parse(d)) }} aria-hidden="true" />
                ))}
                {items.map(({ h, lane, from, to }) => {
                  // No date in the source means no date on the chart: the edge runs to the chart and is dashed.
                  const openStart = !h.from;
                  const openEnd = !h.to;
                  return (
                    <div
                      key={h.id}
                      className={`ss-gov__bar ss-gov__bar--${h.how}${openStart ? " is-open-start" : ""}${openEnd ? " is-open-end" : ""}`}
                      style={{ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})`, top: 4 + lane * 30 }}
                      tabIndex={0}
                      aria-label={`${h.name}: ${HOW[h.how]}${h.from ? `, from ${fmt(h.from)}` : ", start not reported"}${h.to ? `, to ${fmt(h.to)}` : ", end not reported"}${h.note ? `. ${h.note}` : ""}`}
                    >
                      <span>{h.name}</span>
                      <span className="ss-gov__tip" aria-hidden="true">
                        <b>{h.name}</b>
                        <em>{HOW[h.how]}</em>
                        <span>{h.from ? `From ${fmt(h.from)}` : "Start not reported"} · {h.to ? `to ${fmt(h.to)}` : "end not reported"}</span>
                        {h.note && <span className="ss-gov__tipnote">{h.note}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="ss-gov__key el-small el-muted">
        Solid bar: start and end given in the source. Dashed edge: the source does not give that date, so the bar runs to the edge of the chart. Ticks mark decree dates.
      </p>

      <h3 className="el-subhead">The changes, in order</h3>
      <ol className="ss-gov__list">
        {changes.map((h) => (
          <li key={h.id}>
            <span className="ss-gov__when">{h.from ? fmt(h.from) : h.to ? `Left ${fmt(h.to)}` : "Date not reported"}</span>
            <span className={`ss-gov__what ss-gov__what--${h.how}`}>{HOW[h.how]}</span>
            <span className="ss-gov__who"><b>{h.name}</b>, {POSTS.find((p) => p.id === h.post)?.label ?? h.post}{h.note ? <em> {h.note}</em> : null}</span>
            <a href={SOURCES[h.source].url} target="_blank" rel="noreferrer noopener">{SOURCES[h.source].publisher}, {SOURCES[h.source].date}</a>
          </li>
        ))}
      </ol>
      <p className="el-muted el-small">Dates are the decree or article dates. Where a source gives none, the field is left blank rather than estimated. Some listing pages show later dates than the articles they link to; the article dates are used here.</p>
    </div>
  );
}
