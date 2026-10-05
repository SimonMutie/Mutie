import { useEffect, useState } from "react";
import { api, type QueryAiSummaryState, type QueryDay } from "../../api";
import StreamPanel from "./StreamPanel";
import { TONE_COLOR, TONE_LABEL, bucketLabel, viewerTz, type Tone } from "./shared";

/**
 * One day of a query, opened from a node on the events-per-day line.
 *
 * Top to bottom: the AI's summary of that day's headlines (written once,
 * then kept; inside the free daily AI allowance — when it cannot be written
 * the panel says why); the day at a glance, worked out without any AI; and
 * the day's events and conversations, which can be searched and downloaded.
 */

const TONES: Tone[] = ["negative", "neutral", "positive"];
const isWebUrl = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

export default function DayView({ queryId, queryName, day, onClose }: { queryId: string; queryName: string; day: string; onClose: () => void }) {
  const tz = viewerTz();
  const [data, setData] = useState<QueryDay | null>(null);
  const [ai, setAi] = useState<QueryAiSummaryState | "writing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setAi(null);
    setError(null);
    api
      .getQueryDay(queryId, day, tz)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (d.ai.status !== "none") return setAi(d.ai);
        if (d.digest.total < 3) return setAi({ status: "unavailable", reason: "There are too few items on this day to summarise; they are listed below." });
        // No summary of this day has been written yet: ask for one.
        setAi("writing");
        api
          .writeQueryDaySummary(queryId, day, tz)
          .then((state) => !cancelled && setAi(state))
          .catch(() => !cancelled && setAi({ status: "unavailable", reason: "The summary could not be written just now." }));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load this day."));
    return () => {
      cancelled = true;
    };
  }, [queryId, day, tz]);

  // Escape closes the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const digest = data?.digest;
  const toneTotal = digest ? digest.tone.negative + digest.tone.neutral + digest.tone.positive : 0;

  return (
    <div className="qd-day__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="qd-day" role="dialog" aria-modal="true" aria-label={`${bucketLabel(day, true)} — ${queryName}`}>
        <header className="qd-day__head">
          <div>
            <div className="eyebrow">{queryName}</div>
            <h2>{bucketLabel(day, true)}</h2>
            {digest && (
              <div className="qd-day__sub">
                {digest.total.toLocaleString()} item{digest.total === 1 ? "" : "s"} · {digest.events.toLocaleString()} event{digest.events === 1 ? "" : "s"} · {digest.conversations.toLocaleString()}{" "}
                conversation
                {digest.conversations === 1 ? "" : "s"}
              </div>
            )}
          </div>
          <button type="button" className="qd-btn" onClick={onClose} aria-label="Close this day" autoFocus>
            Close ✕
          </button>
        </header>

        <div className="qd-day__body">
          {error && <div className="qd-error">{error}</div>}
          {!data && !error && <div className="qd-empty">Loading…</div>}

          {data && (
            <>
              <section className="qd-day__section">
                <h3>AI summary of the day</h3>
                {ai === "writing" || ai === null ? (
                  <p className="qd-muted">Writing a summary from this day's headlines…</p>
                ) : ai.status === "ready" ? (
                  <>
                    <p className="qd-day__summary">{ai.ai.summary}</p>
                    {ai.ai.developments.length > 0 && (
                      <ul className="qd-day__developments">
                        {ai.ai.developments.map((d, i) => (
                          <li key={i}>
                            {d.text}{" "}
                            {d.sources.map((n) => {
                              const cited = ai.ai.cited.find((c) => c.n === n);
                              if (!cited) return null;
                              return isWebUrl(cited.url) ? (
                                <a key={n} className="qd-cite" href={cited.url} target="_blank" rel="noopener noreferrer" title={cited.title}>
                                  [{cited.source ?? n}]
                                </a>
                              ) : (
                                <span key={n} className="qd-cite" title={cited.title}>
                                  [{cited.source ?? n}]
                                </span>
                              );
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="qd-muted qd-small">
                      Written by AI from the headlines collected that day ({ai.ai.item_count.toLocaleString()} items at the time). It reports what the headlines say; check the sources before relying
                      on it.
                    </p>
                  </>
                ) : (
                  <p className="qd-muted">{ai.status === "unavailable" ? ai.reason : "No summary has been written for this day."} The overview below needs no AI.</p>
                )}
              </section>

              {digest && digest.total > 0 && (
                <section className="qd-day__section">
                  <h3>The day at a glance</h3>
                  {toneTotal > 0 && (
                    <>
                      <div className="qd-legend">
                        {TONES.map((t) => (
                          <span key={t} className="qd-legend__item">
                            <i style={{ background: TONE_COLOR[t] }} />
                            {TONE_LABEL[t]} <b>{Math.round((digest.tone[t] / toneTotal) * 100)}%</b>
                          </span>
                        ))}
                      </div>
                      <div className="qd-split">{TONES.map((t) => digest.tone[t] > 0 && <div key={t} style={{ flexGrow: digest.tone[t], background: TONE_COLOR[t] }} />)}</div>
                    </>
                  )}
                  <dl className="qd-facts">
                    {digest.topics.length > 0 && (
                      <>
                        <dt>Main topics</dt>
                        <dd>
                          {digest.topics.map((t) => (
                            <span key={t.term} className="qd-tag">
                              {t.label} <b>{t.count}</b>
                            </span>
                          ))}
                        </dd>
                      </>
                    )}
                    {digest.places.length > 0 && (
                      <>
                        <dt>Places named</dt>
                        <dd>
                          {digest.places.map((p) => (
                            <span key={p.label} className="qd-tag">
                              {p.label} <b>{p.count}</b>
                            </span>
                          ))}
                        </dd>
                      </>
                    )}
                    {digest.outlets.length > 0 && (
                      <>
                        <dt>Sources</dt>
                        <dd>
                          {digest.outlets.map((o) => (
                            <span key={o.label} className="qd-tag">
                              {o.label} <b>{o.count}</b>
                            </span>
                          ))}
                        </dd>
                      </>
                    )}
                  </dl>
                  {digest.headlines.length > 0 && (
                    <>
                      <h4>Headlines carrying the main topics</h4>
                      <ul className="qd-day__headlines">
                        {digest.headlines.map((h) => (
                          <li key={h.id}>
                            {isWebUrl(h.url) ? (
                              <a href={h.url} target="_blank" rel="noopener noreferrer">
                                {h.title} ↗
                              </a>
                            ) : (
                              h.title
                            )}
                            <span className="qd-muted qd-small">
                              {h.source && ` — ${h.source}`}
                              {h.topic && ` · ${h.topic}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}

              <section className="qd-day__section">
                <h3>Events and conversations</h3>
                <StreamPanel bare queryId={queryId} queryName={`${queryName} — ${day}`} selection={{ day, tz }} periodLabel={bucketLabel(day, true)} />
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
