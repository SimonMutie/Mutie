import { useMemo } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import worldData from "world-atlas/countries-110m.json?url";
import type { EventItem } from "../api";
import type { AlertItem } from "../api";

const LEVEL_COLOR: Record<string, string> = {
  critical: "var(--critical)",
  elevated: "var(--elevated)",
  info: "var(--info)",
};

const SOURCE_COLOR: Record<string, string> = {
  social: "var(--info)",
  news: "var(--positive)",
  forum: "var(--elevated)",
  darkweb: "var(--critical)",
};

interface Props {
  events: EventItem[];
  alerts: AlertItem[];
}

export default function WorldMap({ events, alerts }: Props) {
  const geoEvents = useMemo(
    () => events.filter((e) => e.geo_lat != null && e.geo_lng != null).slice(0, 150),
    [events]
  );
  const openAlerts = useMemo(() => alerts.filter((a) => !a.resolved_at && a.geo_lat != null), [alerts]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <ComposableMap
        projectionConfig={{ scale: 148 }}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={worldData}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="var(--panel-raised)"
                stroke="var(--border)"
                strokeWidth={0.5}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none", fill: "#1d2430" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {geoEvents.map((e) => (
          <Marker key={e.id} coordinates={[e.geo_lng!, e.geo_lat!]}>
            <circle r={2.2} fill={SOURCE_COLOR[e.source_type] ?? "var(--text-muted)"} fillOpacity={0.85} />
          </Marker>
        ))}

        {openAlerts.map((a) => (
          <Marker key={a.id} coordinates={[a.geo_lng!, a.geo_lat!]}>
            <g>
              <circle r={9} fill="none" stroke={LEVEL_COLOR[a.level]} strokeWidth={1.4} opacity={0.5}>
                <animate attributeName="r" values="4;16" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle r={4} fill={LEVEL_COLOR[a.level]} stroke="var(--base)" strokeWidth={1} />
            </g>
          </Marker>
        ))}
      </ComposableMap>

      <div
        style={{
          position: "absolute",
          bottom: 14,
          left: 16,
          display: "flex",
          gap: 16,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        {Object.entries(SOURCE_COLOR).map(([k, color]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}
