import { useMemo } from "react";
import type { VictimGroupRow } from "../api";
import { classifyActor, classifyIncident } from "./actorTheme";
import { Parliament } from "./viz/charts/Radial";
import { useVizTheme } from "./viz/context";
import type { VizResult, VizSpec } from "./viz/types";

const SPEC: VizSpec = {
  kind: "parliament",
  source: "incidents",
  rows: [{ field: "victims" }],
  columns: [],
  values: [{ field: "killed", agg: "sum", label: "People killed" }],
  filters: [],
  options: { topN: 6, fields: { victims: { label: "Who was killed", type: "text" }, killed: { label: "People killed", type: "number" } } },
};

/** The group a row belongs to: the columns that name who was involved first, then what happened. */
export const groupOfVictimRow = (r: VictimGroupRow) => {
  const first = classifyIncident(r);
  if (first.shape !== "other") return first.label;
  return classifyActor(r.tactic).label;
};

export function tallyVictims(rows: VictimGroupRow[], group: string | undefined) {
  const inGroup = group ? rows.filter((r) => groupOfVictimRow(r) === group) : rows;
  const sum = (list: VictimGroupRow[]) =>
    list.reduce((a, r) => ({ women: a.women + r.women, men: a.men + r.men, children: a.children + r.children, unknown: a.unknown + r.unknown, incidents: a.incidents + r.incidents }), { women: 0, men: 0, children: 0, unknown: 0, incidents: 0 });
  const t = sum(inGroup);
  const any = t.women + t.men + t.children + t.unknown > 0;
  // Nothing recorded against that group: show everyone's, and say so.
  return { ...(any || !group ? t : sum(rows)), groupIncidents: t.incidents, fallback: !!group && !any };
}

/** One hemicycle of women, men and children killed, for one group of actors (or everyone). */
export default function VictimsWidget({ rows, group }: { rows: VictimGroupRow[] | undefined; group?: string }) {
  const theme = useVizTheme();
  const data = useMemo(() => (rows ? tallyVictims(rows, group) : null), [rows, group]);
  if (!data) return <div className="vz-empty">Loading…</div>;
  const total = data.women + data.men + data.children + data.unknown;
  if (total === 0) return <div className="vz-empty">No civilian deaths are recorded for this selection.</div>;
  const result: VizResult = {
    rows: [
      { d: ["Women"], m: [data.women] },
      { d: ["Men"], m: [data.men] },
      { d: ["Children"], m: [data.children] },
      ...(data.unknown > 0 ? [{ d: ["Sex or age not recorded"], m: [data.unknown] }] : []),
    ],
    truncated: false,
  };
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ fontSize: 11.5, opacity: 0.75, padding: "0 4px 4px" }}>
        {data.fallback
          ? "Nothing is recorded against that group here, so this shows all civilian deaths."
          : `${total.toLocaleString()} civilian deaths${group ? ` in ${data.groupIncidents.toLocaleString()} ${group.toLowerCase()} incidents` : ""}`}
      </div>
      <div style={{ flex: 1, minHeight: 0 }} className="vz-card--parliament">
        <Parliament viz={SPEC} result={result} theme={theme} selectedKey={null} />
      </div>
    </div>
  );
}
