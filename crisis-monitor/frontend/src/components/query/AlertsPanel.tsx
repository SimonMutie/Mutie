import { useState } from "react";
import type { AlertItem, QueryIncident, QueryWatch, QueryWatchStatus } from "../../api";
import { Empty, Panel, exactTime, timeAgo } from "./shared";

/**
 * Alerts for one query. Top to bottom:
 *
 *   - a status line that is always there: the last 24 hours against what is
 *     usual for this query, so the panel says something even on a quiet day;
 *   - escalation incidents that this query's own wording matches. These come
 *     from the incident pipeline, which codes reports against written
 *     criteria; each shows the criteria it met and its sources;
 *   - coverage surges: the query collecting well above its usual day. A
 *     surge counts reporting and is labelled as that, never as an escalation;
 *   - the surges most recently closed.
 */

interface Props {
  watch: QueryWatch | null;
  error: string | null;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  /** Opens the stream on what an incident or surge is about. */
  onSearch?: (term: string) => void;
}

const isWebUrl = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);
const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const usualWords = (usual: number) => (usual < 1 ? "fewer than one" : `about ${round(usual)}`);

const STATE: Record<QueryWatchStatus["state"], { label: string; tone: "quiet" | "normal" | "raised" | "surge" }> = {
  learning: { label: "Learning what is usual", tone: "quiet" },
  quiet: { label: "Quiet", tone: "quiet" },
  normal: { label: "Normal", tone: "normal" },
  above: { label: "Above usual", tone: "raised" },
  surge: { label: "Coverage surge", tone: "surge" },
};

function StatusLine({ status }: { status: QueryWatchStatus }) {
  const s = STATE[status.state];
  const items = `${status.last24h.toLocaleString()} item${status.last24h === 1 ? "" : "s"} in the last 24 hours`;
  const detail =
    status.state === "learning"
      ? `${items}. A usual day cannot be judged until this query has a week of history (it has ${status.basisDays} day${status.basisDays === 1 ? "" : "s"}).`
      : `${items}; a usual day has ${usualWords(status.usual)}. A surge is called at ${status.threshold.toLocaleString()}.`;
  // The bar: today's count along a track that ends a little past the surge mark.
  const max = Math.max(status.threshold * 1.25, status.last24h, 1);
  return (
    <div className={`qd-status qd-status--${s.tone}`}>
      <div className="qd-status__head">
        <span className="qd-status__badge">{s.label}</span>
        <span className="qd-status__when" title={`Worked out ${exactTime(status.computedAt)}. Checked every 15 minutes.`}>
          checked {timeAgo(status.computedAt)}
        </span>
      </div>
      <div className="qd-status__text">{detail}</div>
      {status.state !== "learning" && (
        <div className="qd-status__track" role="img" aria-label={`${status.last24h} items against a usual ${round(status.usual)} and a surge mark of ${status.threshold}`}>
          <div className="qd-status__fill" style={{ width: `${Math.min(100, (status.last24h / max) * 100)}%` }} />
          <i className="qd-status__mark qd-status__mark--usual" style={{ left: `${(Math.max(status.usual, 0) / max) * 100}%` }} title={`Usual: ${usualWords(status.usual)} a day`} />
          <i className="qd-status__mark qd-status__mark--surge" style={{ left: `${(status.threshold / max) * 100}%` }} title={`Surge at ${status.threshold}`} />
        </div>
      )}
      {status.state !== "learning" && (
        <div className="qd-status__key">
          <span>
            <i className="qd-status__mark--usual" /> usual
          </span>
          <span>
            <i className="qd-status__mark--surge" /> surge mark
          </span>
          <span title="The median day over this many days">measured over {status.basisDays} days</span>
        </div>
      )}
    </div>
  );
}

function Incident({ incident, onSearch }: { incident: QueryIncident; onSearch?: (term: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`qd-alert qd-alert--${incident.level}`}>
      <div className="qd-alert__meta">
        <span className="qd-alert__level">{incident.level === "critical" ? "Critical" : "Elevated"} escalation</span>
        {incident.preliminary && (
          <span className="qd-alert__flag" title="Known so far only from headlines; no article behind it has yet been read in full.">
            preliminary
          </span>
        )}
        <time dateTime={incident.updatedAt} title={exactTime(incident.updatedAt)}>
          updated {timeAgo(incident.updatedAt)}
        </time>
      </div>
      <h4 className="qd-alert__title">{incident.headline}</h4>
      <div className="qd-alert__place">
        {onSearch ? (
          <button type="button" className="qd-link" onClick={() => onSearch(incident.place.split(",")[0])} title="Show this query's items mentioning this place">
            {incident.place}
          </button>
        ) : (
          incident.place
        )}
        {incident.geoPrecision !== "place" && <span> · located to {incident.geoPrecision === "country" ? "the country only" : `the ${incident.geoPrecision}`}</span>}
        {incident.fatalitiesMax != null && incident.fatalitiesMax > 0 && <span> · up to {incident.fatalitiesMax.toLocaleString()} reported killed</span>}
      </div>
      <p className="qd-alert__text">{incident.summary}</p>
      {incident.criteriaMet.length > 0 && (
        <>
          <div className="qd-alert__label">Criteria met</div>
          <ul className="qd-alert__list">
            {incident.criteriaMet.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="qd-link qd-small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide sources" : `Sources (${incident.sourceCount})`}
      </button>
      {open && (
        <ol className="qd-alert__sources">
          {incident.sources.map((s) => (
            <li key={s.n}>
              {isWebUrl(s.url) ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title || s.url} ↗
                </a>
              ) : (
                (s.title ?? s.domain)
              )}{" "}
              <span className="qd-muted">{s.domain}</span>
            </li>
          ))}
          {incident.sourceCount > incident.sources.length && <li className="qd-muted">and {incident.sourceCount - incident.sources.length} more, on the Live Intel map</li>}
        </ol>
      )}
    </article>
  );
}

function Surge({ alert, closed, onAcknowledge, onResolve }: { alert: AlertItem; closed?: boolean; onAcknowledge?: (id: string) => void; onResolve?: (id: string) => void }) {
  const snap = alert.metric_snapshot ?? {};
  const isSurge = snap.kind === "surge";
  return (
    <article className={`qd-alert qd-alert--${isSurge ? "surge" : alert.level}${closed ? " is-closed" : ""}`}>
      <div className="qd-alert__meta">
        <span className="qd-alert__level">{isSurge ? (snap.major ? "Major coverage surge" : "Coverage surge") : alert.level}</span>
        {closed && alert.resolved_at ? (
          <time dateTime={alert.resolved_at} title={`Opened ${exactTime(alert.created_at)}; closed ${exactTime(alert.resolved_at)}`}>
            closed {timeAgo(alert.resolved_at)}
          </time>
        ) : (
          <time dateTime={alert.created_at} title={exactTime(alert.created_at)}>
            opened {timeAgo(alert.created_at)}
          </time>
        )}
        {alert.acknowledged_at && !closed && <span className="qd-alert__flag">acknowledged</span>}
      </div>
      {isSurge && snap.last24h != null && snap.usual != null ? (
        <h4 className="qd-alert__title">
          {snap.last24h.toLocaleString()} items in 24 hours
          {snap.usual >= 1 ? `, ${round(Math.round((snap.last24h / snap.usual) * 10) / 10)} times the usual ${round(snap.usual)}` : ", against a usual day of fewer than one"}
        </h4>
      ) : (
        <h4 className="qd-alert__title">{alert.title}</h4>
      )}
      {!closed && <p className="qd-alert__text">{isSurge ? "This counts reporting. It is not a judgement that the situation itself has escalated." : alert.description}</p>}
      {!closed && Array.isArray(snap.criteriaMet) && snap.criteriaMet.length > 0 && (
        <>
          <div className="qd-alert__label">Why this was raised</div>
          <ul className="qd-alert__list">
            {snap.criteriaMet.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {!closed && Array.isArray(snap.headlines) && snap.headlines.length > 0 && (
        <>
          <div className="qd-alert__label">Latest headlines when it opened</div>
          <ul className="qd-alert__list">
            {snap.headlines.map((h, i) => (
              <li key={i}>
                {isWebUrl(h.url) ? (
                  <a href={h.url} target="_blank" rel="noopener noreferrer">
                    {h.title} ↗
                  </a>
                ) : (
                  h.title
                )}
                {h.source && <span className="qd-muted"> {h.source}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {!closed && (
        <div className="qd-alert__actions">
          {!alert.acknowledged_at && onAcknowledge && (
            <button type="button" className="qd-btn" onClick={() => onAcknowledge(alert.id)} title="Mark as seen. It stays open.">
              Acknowledge
            </button>
          )}
          {onResolve && (
            <button type="button" className="qd-btn" onClick={() => onResolve(alert.id)} title="Close it now. A surge also closes by itself once coverage falls back.">
              Resolve
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default function AlertsPanel({ watch, error, onAcknowledge, onResolve, onSearch }: Props) {
  const open = (watch?.incidents.length ?? 0) + (watch?.alerts.length ?? 0);
  return (
    <Panel title="Alerts" note={watch ? (open ? `${open} open, for this query` : "none open, for this query") : undefined} bodyStyle={{ padding: 0 }}>
      {!watch ? (
        <Empty>{error ?? "Loading…"}</Empty>
      ) : (
        <div className="qd-scroll qd-alerts">
          {watch.status && <StatusLine status={watch.status} />}

          {watch.incidents.length > 0 && (
            <section>
              <h3 className="qd-alerts__head" title="Incidents flagged by the escalation pipeline, which reads reports against written criteria, and which this query's own wording matches.">
                Escalation incidents matching this query
              </h3>
              {watch.incidents.map((i) => (
                <Incident key={i.id} incident={i} onSearch={onSearch} />
              ))}
            </section>
          )}

          {watch.alerts.length > 0 && (
            <section>
              <h3 className="qd-alerts__head">Coverage</h3>
              {watch.alerts.map((a) => (
                <Surge key={a.id} alert={a} onAcknowledge={onAcknowledge} onResolve={onResolve} />
              ))}
            </section>
          )}

          {open === 0 && <p className="qd-alerts__none">Nothing is open. An alert appears here when an escalation incident matches this query, or when the query collects well above its usual day.</p>}

          {watch.closed.length > 0 && (
            <section>
              <h3 className="qd-alerts__head">Recently closed</h3>
              {watch.closed.map((a) => (
                <Surge key={a.id} alert={a} closed />
              ))}
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}
