import { useState } from "react";
import type { QueryOverview, QuerySourceMix } from "../../api";
import { Empty, Panel } from "./shared";

/**
 * Who is reporting and where: the outlets with the most items in the
 * period, the places most often named, or — "Mix" — where those outlets are
 * based relative to the countries the reporting is about, and how much of
 * it comes from a single outlet. One measure, one colour for the lists; the
 * mix is four named parts, each labelled with its share.
 */

const MIX = [
  { key: "inCountry", color: "#2a78d6" },
  { key: "elsewhereInAfrica", color: "#e8622c" },
  { key: "international", color: "#1baf7a" },
  { key: "unclassified", color: "#a9b1bf" },
] as const;

function Mix({ mix }: { mix: QuerySourceMix }) {
  const where = mix.countries.length ? (mix.countries.length > 1 ? `${mix.countries.slice(0, -1).join(", ")} or ${mix.countries[mix.countries.length - 1]}` : mix.countries[0]) : null;
  const label: Record<(typeof MIX)[number]["key"], string> = {
    inCountry: where ? `Outlets based in ${where}` : "Outlets based in the country reported on",
    elsewhereInAfrica: "Other African and pan-African outlets",
    international: "International outlets and institutions",
    unclassified: "Not classified",
  };
  const total = MIX.reduce((n, m) => n + mix[m.key], 0);
  if (total === 0) return <Empty>No news outlets in this period.</Empty>;
  const parts = MIX.map((m) => ({ ...m, label: label[m.key], count: mix[m.key], share: mix[m.key] / total })).filter((p) => p.count > 0 || p.key !== "unclassified");
  return (
    <div className="qd-scroll">
      {/* A 2px gap in the surface colour separates the parts, so they read apart without relying on hue. */}
      <div className="qd-mix__bar" role="img" aria-label={parts.map((p) => `${p.label}: ${Math.round(p.share * 100)}%`).join("; ")}>
        {parts
          .filter((p) => p.count > 0)
          .map((p) => (
            <div key={p.key} style={{ flexGrow: p.count, background: p.color }} title={`${p.label}: ${p.count.toLocaleString()} items (${Math.round(p.share * 100)}%)`} />
          ))}
      </div>
      <ul className="qd-mix__list">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <b>{Math.round(p.share * 100)}%</b>
            <em>{p.count.toLocaleString()}</em>
          </li>
        ))}
      </ul>
      {!where && <p className="qd-mix__note">The items name no country, so no outlet can be counted as in-country.</p>}
      {mix.largest && (
        <p className="qd-mix__note">
          <b>{mix.outlets.toLocaleString()}</b> outlet{mix.outlets === 1 ? "" : "s"} in all. The largest, {mix.largest.label}, carries <b>{Math.round(mix.largest.share * 100)}%</b> of the reports
          {mix.largest.share >= 0.4 ? ": much of this picture is one outlet's." : "."}
        </p>
      )}
      <p className="qd-mix__note qd-muted">An outlet's home comes from the platform's source list, a short list of well-known outlets, or a national web address. Others are left unclassified.</p>
    </div>
  );
}

export default function SourcesPanel({ overview, onSearch }: { overview: QueryOverview | null; onSearch?: (term: string) => void }) {
  const [show, setShow] = useState<"outlets" | "places" | "mix">("outlets");
  const rows = (show === "places" ? overview?.places : overview?.outlets) ?? [];
  const most = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel
      title={show === "outlets" ? "Top sources" : show === "places" ? "Top places" : "Source mix"}
      actions={
        <div className="qd-seg" role="group" aria-label="Show">
          <button type="button" className={show === "outlets" ? "is-on" : ""} aria-pressed={show === "outlets"} onClick={() => setShow("outlets")}>
            Sources
          </button>
          <button type="button" className={show === "places" ? "is-on" : ""} aria-pressed={show === "places"} onClick={() => setShow("places")}>
            Places
          </button>
          <button type="button" className={show === "mix" ? "is-on" : ""} aria-pressed={show === "mix"} onClick={() => setShow("mix")} title="Where the outlets are based">
            Mix
          </button>
        </div>
      }
    >
      {!overview ? (
        <Empty>Loading…</Empty>
      ) : show === "mix" ? (
        overview.sourceMix ? (
          <Mix mix={overview.sourceMix} />
        ) : (
          <Empty>Not available for this period.</Empty>
        )
      ) : rows.length === 0 ? (
        <Empty>{show === "outlets" ? "No news outlets in this period." : "None of the items in this period names a place."}</Empty>
      ) : (
        <div className="qd-scroll">
          <ul className="qd-bars">
            {rows.map((r) => (
              <li key={r.label}>
                <div className="qd-bars__label">
                  {/* A place can be searched for in the stream; an outlet's address is not in an item's text. */}
                  {show === "places" && onSearch ? (
                    <button type="button" className="qd-link" onClick={() => onSearch(r.label.split(",")[0])} title="Show items mentioning this place">
                      {r.label}
                    </button>
                  ) : (
                    <span>{r.label}</span>
                  )}
                  <b>{r.count.toLocaleString()}</b>
                </div>
                <div className="qd-bars__track">
                  <div style={{ width: `${Math.max(2, (r.count / most) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
