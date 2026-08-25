import { useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import worldData from "world-atlas/countries-110m.json?url";
import type { IncidentItem } from "../api";

interface Props {
  incidents: IncidentItem[];
}

// Severity is free-text from the source spreadsheet, so this matches common
// variants case-insensitively rather than assuming one fixed vocabulary —
// anything unrecognized falls back to the neutral/default color.
function severityColor(severity: string | null | undefined): string {
  const s = (severity ?? "").toLowerCase();
  if (/(critical|extreme|severe|high)/.test(s)) return "var(--critical)";
  if (/(elevated|moderate|medium|med\b)/.test(s)) return "var(--elevated)";
  if (/(low|minor|minimal)/.test(s)) return "var(--positive)";
  return "var(--info)";
}

function totalCasualties(i: IncidentItem): number {
  return (
    (i.civilian_death_child ?? 0) +
    (i.civilian_death_female ?? 0) +
    (i.civilian_death_male ?? 0) +
    (i.civilian_death_unknown ?? 0) +
    (i.civilian_injury_female ?? 0) +
    (i.civilian_injury_male ?? 0) +
    (i.civilian_injury_unknown ?? 0)
  );
}

export default function IncidentsMap({ incidents }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; item: IncidentItem } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHide() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    hideTimer.current = setTimeout(() => setHover(null), 200);
  }

  const geoIncidents = useMemo(() => incidents.filter((i) => i.latitude != null && i.longitude != null), [incidents]);

  function pointerToLocal(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function show(evt: React.MouseEvent, item: IncidentItem) {
    cancelHide();
    const { x, y } = pointerToLocal(evt.clientX, evt.clientY);
    setHover({ x, y, item });
  }
  function move(evt: React.MouseEvent) {
    if (!hover) return;
    const { x, y } = pointerToLocal(evt.clientX, evt.clientY);
    setHover((h) => (h ? { ...h, x, y } : h));
  }

  const containerWidth = containerRef.current?.clientWidth ?? 1000;
  const tooltipWidth = 280;
  const flip = hover ? hover.x + 16 + tooltipWidth > containerWidth : false;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <ComposableMap projectionConfig={{ scale: 148 }} style={{ width: "100%", height: "100%" }}>
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
                  hover: { outline: "none", fill: "var(--panel-hover)" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {geoIncidents.map((i) => (
          <Marker key={i.id} coordinates={[i.longitude!, i.latitude!]}>
            <g onMouseEnter={(evt) => show(evt, i)} onMouseMove={move} onMouseLeave={scheduleHide} style={{ cursor: "default" }}>
              <circle r={9} fill="transparent" />
              <circle r={2.4} fill={severityColor(i.severity)} fillOpacity={0.85} />
            </g>
          </Marker>
        ))}
      </ComposableMap>

      {hover && (
        <div
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          style={{
            position: "absolute",
            left: flip ? undefined : hover.x + 16,
            right: flip ? containerWidth - hover.x + 16 : undefined,
            top: Math.max(8, hover.y - 8),
            width: tooltipWidth,
            background: "var(--panel-raised)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            boxShadow: "0 8px 24px rgba(19, 23, 34, 0.14)",
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span
              className="mono"
              style={{ fontSize: 10.5, fontWeight: 600, color: severityColor(hover.item.severity), textTransform: "uppercase" }}
            >
              {hover.item.severity || "Unspecified severity"}
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
              {hover.item.occurred_date || ""}
            </span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
            {[hover.item.city, hover.item.province].filter(Boolean).join(", ") || hover.item.precise_location || "Unknown location"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>
            {[hover.item.sector, hover.item.tactic, hover.item.actor].filter(Boolean).join(" · ")}
          </div>
          {totalCasualties(hover.item) > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--critical)" }}>{totalCasualties(hover.item)} civilian casualties</div>
          )}
          {hover.item.details && (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
              {hover.item.details.slice(0, 160)}
              {hover.item.details.length > 160 ? "…" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
