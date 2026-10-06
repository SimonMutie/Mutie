import { useEffect, useMemo } from "react";
import { useOwnSelection, useViz, useVizData } from "./context";
import { dimLabel, fmtMeasure } from "./format";
import { compileQuery, dimTitle, fieldInfo, filtersForValue, measureLabel, measuresOf, missing, valuesOf, type FieldType, type VizDim, type VizResult, type VizSpec } from "./types";
import { Bullet, BoxPlot, Butterfly, Dumbbell, Lollipop, Pareto, Progress } from "./charts/Compare";
import { Chord, Funnel, Marimekko, Network, Sankey } from "./charts/Flow";
import HBars from "./charts/HBars";
import { Bubbles, Figures, Pictogram, WordCloud } from "./charts/Info";
import { Choropleth, DotMap, GlobeMap, SymbolMap, TileMap } from "./charts/Maps";
import { Heatmap, Rank, Scatter, Slope, Waterfall } from "./charts/Others";
import { Donut, Pie, Treemap, Waffle } from "./charts/Parts";
import Pivot from "./charts/Pivot";
import { Parliament, Radar, RadialBar, Ring, Rose, Sunburst } from "./charts/Radial";
import { Gauge, Kpi, TextCard } from "./charts/Singles";
import Slicer from "./charts/Slicer";
import { Bump, Calendar, Combo, Multiples, Race, Stream, Trends } from "./charts/Time";
import XYChart from "./charts/XYChart";
import type { ChartProps } from "./charts/kit";

/**
 * One visual, without its card: fetches its data and draws whichever kind
 * it is — or says, in words, why there is nothing to draw yet. Used inside
 * the dashboard card and as the live preview in the builder.
 */

/** Kinds whose figures are also offered as a plain table (the rest are tables, single figures or controls already). */
/** Kinds whose figures are also offered as a plain table. The rest are tables, single figures, controls or text already. */
const NO_TABLE_VIEW = new Set<string>(["pivot", "rank", "trends", "kpi", "figures", "gauge", "ring", "slicer", "text", "progress"]);
export const HAS_TABLE_VIEW = { has: (kind: string) => !NO_TABLE_VIEW.has(kind) };

/** The data behind a visual as a flat table: one row per group, the figures as numbers. Used for the table view and for downloads. */
export function flatTable(viz: VizSpec, result: VizResult): { columns: string[]; rows: (string | number | null)[][]; numeric: boolean[] } {
  // The request the visual made says exactly which groups and figures came back (a calendar groups by day, a box plot asks for six figures).
  const query = compileQuery(viz);
  const dims: VizDim[] = query?.dimensions ?? [...viz.rows, ...viz.columns];
  const measures = query?.measures ?? valuesOf(viz);
  const width = result.rows[0]?.d.length ?? dims.length;
  const used = dims.slice(0, width);
  return {
    columns: [...used.map((d) => dimTitle(viz, d)), ...measures.slice(0, result.rows[0]?.m.length ?? measures.length).map((m) => measureLabel(viz, m))],
    rows: result.rows.map((r) => [...r.d.map((v, i) => dimLabel(v, used[i], used[i] ? fieldInfo(viz, used[i].field).type : "text")), ...r.m]),
    numeric: [...used.map(() => false), ...measures.map(() => true)],
  };
}

function FlatTable({ viz, result }: { viz: VizSpec; result: VizResult }) {
  const table = useMemo(() => flatTable(viz, result), [viz, result]);
  const measures = measuresOf(viz);
  const nDims = table.columns.length - Math.min(measures.length, result.rows[0]?.m.length ?? measures.length);
  return (
    <div className="vz-frame">
      <div className="vz-pivot">
        <table>
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={i} className={i >= nDims ? "is-measure" : "vz-pivot__corner"}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 500).map((r, ri) => (
              <tr key={ri}>
                {r.map((v, i) =>
                  i < nDims ? (
                    <th key={i} scope="row">
                      {v}
                    </th>
                  ) : (
                    <td key={i}>{fmtMeasure(v as number | null, measures[i - nDims], viz.options)}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length > 500 && <div className="vz-note">The first 500 of {table.rows.length.toLocaleString()} rows are shown. Download the table for all of them.</div>}
    </div>
  );
}

interface Props {
  widgetId: string;
  viz: VizSpec;
  view?: "chart" | "table";
  /** False where a click should not filter anything (the builder's preview). */
  interactive?: boolean;
  /** The card's title, so a visual need not repeat it. */
  title?: string;
  /** Hands the fetched data up, for the card's downloads. */
  onData?: (result: VizResult | null) => void;
}

export default function VizBody({ widgetId, viz, view = "chart", interactive = true, title, onData }: Props) {
  const ctx = useViz();
  const own = useOwnSelection(widgetId);
  const why = missing(viz);
  const data = useVizData(widgetId, viz);
  const result = data.result;
  useEffect(() => {
    onData?.(result);
  }, [result, onData]);

  if (viz.kind === "text") return <TextCard viz={viz} theme={ctx.theme} />;
  if (why) return <div className="vz-empty">{why}</div>;
  if (data.error) return <div className="vz-empty vz-empty--error">{data.error}</div>;
  if (!result) return <div className="vz-empty">Loading…</div>;

  if (viz.kind === "slicer") return <Slicer widgetId={widgetId} viz={viz} result={result} />;

  const hasFigure = viz.kind === "kpi" || viz.kind === "gauge" || viz.kind === "ring" || viz.kind === "figures";
  if (!hasFigure && result.rows.length === 0) return <div className="vz-empty">{data.narrowed ? "Nothing matches the current filters." : "There is no data for this yet."}</div>;

  if (view === "table" && HAS_TABLE_VIEW.has(viz.kind)) return <FlatTable viz={viz} result={result} />;

  const onPick = interactive
    ? (dim: VizDim, type: FieldType, raw: string | number | null, label: string, key: string) => {
        if (own?.key === key) return ctx.select(widgetId, null);
        const filters = filtersForValue(dim, raw, type);
        if (!filters) return;
        ctx.select(widgetId, { origin: widgetId, source: viz.source, key, label: `${fieldInfo(viz, dim.field).label}: ${label}`, filters });
      }
    : undefined;
  const props: ChartProps = { viz, result, theme: ctx.theme, selectedKey: own?.key ?? null, onPick, title };

  switch (viz.kind) {
    case "pivot":
      return <Pivot {...props} />;
    case "rank":
      return <Rank {...props} />;
    case "bar": {
      const orientation = viz.options?.orientation ?? "auto";
      if (orientation === "horizontal" || (orientation === "auto" && liesDown(viz, result))) return <HBars {...props} />;
      return <XYChart {...props} />;
    }
    case "line":
    case "area":
    case "histogram":
      return <XYChart {...props} />;
    case "heatmap":
      return <Heatmap {...props} />;
    case "slope":
      return <Slope {...props} />;
    case "scatter":
      return <Scatter {...props} />;
    case "treemap":
      return <Treemap {...props} />;
    case "donut":
      return <Donut {...props} />;
    case "waffle":
      return <Waffle {...props} />;
    case "waterfall":
      return <Waterfall {...props} />;
    case "kpi":
      return <Kpi {...props} />;
    case "gauge":
      return <Gauge {...props} />;
    case "trends":
      return <Trends {...props} />;
    case "lollipop":
      return <Lollipop {...props} />;
    case "dumbbell":
      return <Dumbbell {...props} />;
    case "butterfly":
      return <Butterfly {...props} />;
    case "bullet":
      return <Bullet {...props} />;
    case "pareto":
      return <Pareto {...props} />;
    case "marimekko":
      return <Marimekko {...props} />;
    case "radar":
      return <Radar {...props} />;
    case "stream":
      return <Stream {...props} />;
    case "bump":
      return <Bump {...props} />;
    case "multiples":
      return <Multiples {...props} />;
    case "combo":
      return <Combo {...props} />;
    case "calendar":
      return <Calendar {...props} />;
    case "race":
      return <Race {...props} />;
    case "pie":
      return <Pie {...props} />;
    case "rose":
      return <Rose {...props} />;
    case "radialbar":
      return <RadialBar {...props} />;
    case "sunburst":
      return <Sunburst {...props} />;
    case "funnel":
      return <Funnel {...props} />;
    case "progress":
      return <Progress {...props} />;
    case "boxplot":
      return <BoxPlot {...props} />;
    case "sankey":
      return <Sankey {...props} />;
    case "chord":
      return <Chord {...props} />;
    case "network":
      return <Network {...props} />;
    case "choropleth":
      return <Choropleth {...props} />;
    case "symbolmap":
      return <SymbolMap {...props} />;
    case "tilemap":
      return <TileMap {...props} />;
    case "dotmap":
      return <DotMap {...props} />;
    case "globe":
      return <GlobeMap {...props} />;
    case "figures":
      return <Figures {...props} />;
    case "ring":
      return <Ring {...props} />;
    case "pictogram":
      return <Pictogram {...props} />;
    case "parliament":
      return <Parliament {...props} />;
    case "bubbles":
      return <Bubbles {...props} />;
    case "wordcloud":
      return <WordCloud {...props} />;
    default:
      return <div className="vz-empty">This kind of visual is not known to this version of the site.</div>;
  }
}

/** Names read better beside a lying bar than under an upright one, once they are long or many. Time always runs left to right. */
function liesDown(viz: VizSpec, result: VizResult): boolean {
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  if (dim.grain || dim.bin !== undefined || type === "date" || type === "number") return false;
  const names = new Set<string>();
  let longest = 0;
  for (const r of result.rows) {
    const s = String(r.d[0] ?? "");
    names.add(s);
    longest = Math.max(longest, s.length);
  }
  return names.size > 6 || longest > 10;
}
