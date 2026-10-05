import type { EscalationIncident } from "../api";
import { liveuamapLink } from "../liveuamap";
import "./EscalationHoverCard.css";

/**
 * The small card shown when the pointer rests on an escalation marker, on
 * both maps: the level, what is being reported, where and when, and links
 * that can be clicked — the reports themselves and Liveuamap's map of the
 * place. It stays open while the pointer is on the marker or on the card,
 * so the links can be reached.
 *
 * Everything in it is rendered as text by React; nothing from a report is
 * ever inserted as markup, and a link is only made from an ordinary web
 * address.
 */

const LEVEL: Record<EscalationIncident["level"], string> = { elevated: "ELEVATED", critical: "CRITICAL" };
const isWebUrl = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);

const clamp = (text: string, max: number) => {
  const t = text
    .replace(/\s*\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).replace(/[\s,;:.]+$/, "")}…`;
};

const dayLabel = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

/** "3h ago" / "25 min ago" — how recently the newest source was published. */
function ago(iso: string | null): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export default function EscalationHoverCard({ incident, clickHint }: { incident: EscalationIncident; clickHint?: string }) {
  const where = incident.locationLabel ? `${incident.locationLabel}, ${incident.countryName}` : incident.countryName;
  const when = dayLabel(incident.lastEventDate);
  const sources = incident.sources.filter((s) => isWebUrl(s.url));
  const newest = ago(sources[0]?.publishedAt ?? null);
  const liveuamap = liveuamapLink(incident.countryCode, incident.lat, incident.lon, incident.geoPrecision);
  const facts = [
    `${incident.sources.length} source${incident.sources.length === 1 ? "" : "s"}`,
    incident.fatalitiesMax != null ? `${incident.fatalitiesMax} death${incident.fatalitiesMax === 1 ? "" : "s"} reported` : null,
    newest ? `latest ${newest}` : null,
  ].filter(Boolean);

  return (
    <div className={`esc-hover esc-hover--${incident.level}`}>
      <div className="esc-hover__top">
        <span className={`esc-hover__level esc-hover__level--${incident.level}`}>⚠ {LEVEL[incident.level]}</span>
        {incident.preliminary && <span className="esc-hover__tag">PRELIMINARY · HEADLINES</span>}
      </div>
      <div className="esc-hover__headline">{clamp(incident.headline, 150)}</div>
      <div className="esc-hover__where">
        {where}
        {when && <> · {when}</>}
      </div>
      {incident.summary && <div className="esc-hover__summary">{clamp(incident.summary, 300)}</div>}
      <div className="esc-hover__facts">{facts.join(" · ")}</div>
      <div className="esc-hover__links">
        {sources.slice(0, 3).map((s) => (
          <a key={s.n} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title ?? s.domain}>
            [{s.n}] {s.domain} ↗
          </a>
        ))}
        <a href={liveuamap.url} target="_blank" rel="noopener noreferrer">
          {liveuamap.mapName} on Liveuamap ↗
        </a>
      </div>
      {clickHint && <div className="esc-hover__hint">{clickHint}</div>}
    </div>
  );
}
