import { createContext, useContext } from "react";

/** The map's drawing tools share one rail button ("Draw"); inside its panel these tabs switch between them. */
export type DrawTool = "shapes" | "draw" | "route" | "gis";

export const DRAW_TOOLS: { key: DrawTool; label: string; hint: string }[] = [
  { key: "shapes", label: "Shapes", hint: "Draw areas, lines, routes, icons and text; upload shapefiles, GeoJSON or KML; save and style layers" },
  { key: "draw", label: "Measure", hint: "Measure distances, areas and bearings by clicking on the map" },
  { key: "route", label: "Route", hint: "Plan a road route between two points and search incidents along it" },
  { key: "gis", label: "GIS", hint: "Attribute table, buffers, range rings, export and print" },
];

export const isDrawTool = (t: string | null | undefined): t is DrawTool => DRAW_TOOLS.some((d) => d.key === t);

export const DrawTabsContext = createContext<{ active: DrawTool; onSelect: (t: DrawTool) => void } | null>(null);

/** The tab strip at the top of each drawing panel. Renders nothing outside the Draw panel. */
export function DrawTabs({ accent = "#d4af37", muted = "rgba(255,255,255,0.6)" }: { accent?: string; muted?: string }) {
  const ctx = useContext(DrawTabsContext);
  if (!ctx) return null;
  return (
    <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 6 }}>
      {DRAW_TOOLS.map((t) => {
        const on = ctx.active === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            title={t.hint}
            onClick={() => ctx.onSelect(t.key)}
            style={{ flex: 1, padding: "5px 4px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: `1px solid ${on ? accent : "transparent"}`, background: on ? "rgba(212,175,55,0.16)" : "transparent", color: on ? accent : muted }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
