import { useState } from "react";
import type { QueryOverview } from "../../api";
import { Empty, Panel } from "./shared";

/**
 * Who is reporting and where: the outlets with the most items in the
 * period, or the places most often named. One measure, one colour — the
 * bars are for comparing lengths, and each carries its figure.
 */
export default function SourcesPanel({ overview, onSearch }: { overview: QueryOverview | null; onSearch?: (term: string) => void }) {
  const [show, setShow] = useState<"outlets" | "places">("outlets");
  const rows = (show === "outlets" ? overview?.outlets : overview?.places) ?? [];
  const most = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel
      title={show === "outlets" ? "Top sources" : "Top places"}
      actions={
        <div className="qd-seg" role="group" aria-label="Show">
          <button type="button" className={show === "outlets" ? "is-on" : ""} aria-pressed={show === "outlets"} onClick={() => setShow("outlets")}>
            Sources
          </button>
          <button type="button" className={show === "places" ? "is-on" : ""} aria-pressed={show === "places"} onClick={() => setShow("places")}>
            Places
          </button>
        </div>
      }
    >
      {!overview ? (
        <Empty>Loading…</Empty>
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
