import { useMemo, useRef, useState } from "react";
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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function sentimentLabel(s: number | null): string {
  if (s == null) return "unknown";
  if (s < -0.2) return "negative";
  if (s > 0.2) return "positive";
  return "neutral";
}

type Hover =
  | { kind: "event"; x: number; y: number; item: EventItem }
  | { kind: "alert"; x: number; y: number; item: AlertItem };

interface Props {
  events: EventItem[];
  alerts: AlertItem[];
}

export default function WorldMap({ events, alerts }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHide() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  // Small delay (rather than hiding instantly on mouse-leave) gives the user
  // time to move from the marker into the tooltip itself to click the article
  // link — without this, the tooltip disappears before the cursor gets there.
  function scheduleHide() {
    cancelHide();
    hideTimer.current = setTimeout(() => setHover(null), 200);
  }

  const geoEvents = useMemo(
    () => events.filter((e) => e.geo_lat != null && e.geo_lng != null).slice(0, 150),
    [events]
  );
  const openAlerts = useMemo(() => alerts.filter((a) => !a.resolved_at && a.geo_lat != null), [alerts]);

  function pointerToLocal(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function showEvent(evt: React.MouseEvent, item: EventItem) {
    cancelHide();
    const { x, y } = pointerToLocal(evt.clientX, evt.clientY);
    setHover({ kind: "event", x, y, item });
  }

  function showAlert(evt: React.MouseEvent, item: AlertItem) {
    cancelHide();
    const { x, y } = pointerToLocal(evt.clientX, evt.clientY);
    setHover({ kind: "alert", x, y, item });
  }

  function moveHover(evt: React.MouseEvent) {
    if (!hover) return;
    const { x, y } = pointerToLocal(evt.clientX, evt.clientY);
    setHover((h) => (h ? { ...h, x, y } : h));
  }

  function hideHover() {
    scheduleHide();
  }

  const containerWidth = containerRef.current?.clientWidth ?? 1000;
  const tooltipWidth = 280;
  const flip = hover ? hover.x + 16 + tooltipWidth > containerWidth : false;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
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
                  hover: { outline: "none", fill: "var(--panel-hover)" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {geoEvents.map((e) => (
          <Marker key={e.id} coordinates={[e.geo_lng!, e.geo_lat!]}>
            <g
              style={{ cursor: e.url ? "pointer" : "default" }}
              onMouseEnter={(evt) => showEvent(evt, e)}
              onMouseMove={moveHover}
              onMouseLeave={hideHover}
              onClick={() => {
                if (e.url) window.open(e.url, "_blank", "noopener,noreferrer");
              }}
            >
              {/* generous invisible hit area — the visible dot is too small to hover precisely */}
              <circle r={9} fill="transparent" />
              <circle r={2.2} fill={SOURCE_COLOR[e.source_type] ?? "var(--text-muted)"} fillOpacity={0.85} />
            </g>
          </Marker>
        ))}

        {openAlerts.map((a) => (
          <Marker key={a.id} coordinates={[a.geo_lng!, a.geo_lat!]}>
            <g
              style={{ cursor: "pointer" }}
              onMouseEnter={(evt) => showAlert(evt, a)}
              onMouseMove={moveHover}
              onMouseLeave={hideHover}
            >
              <circle r={16} fill="transparent" />
              <circle r={9} fill="none" stroke={LEVEL_COLOR[a.level]} strokeWidth={1.4} opacity={0.5}>
                <animate attributeName="r" values="4;16" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle r={4} fill={LEVEL_COLOR[a.level]} stroke="var(--base)" strokeWidth={1} />
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
          {hover.kind === "event" ? (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 4,
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    color: SOURCE_COLOR[hover.item.source_type] ?? "var(--text-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  {hover.item.source_type}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  {timeAgo(hover.item.published_at)}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 6 }}>{hover.item.content}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
                <span>{hover.item.geo_label ?? "Unknown location"}</span>
                <span>sentiment: {sentimentLabel(hover.item.sentiment)}</span>
              </div>
              {hover.item.url && (
                <a
                  href={hover.item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    marginTop: 8,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--info)",
                    textDecoration: "none",
                  }}
                >
                  Open article ↗
                </a>
              )}
            </>
          ) : (
            <>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: LEVEL_COLOR[hover.item.level],
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                {hover.item.level}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{hover.item.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.4 }}>{hover.item.description}</div>
            </>
          )}
        </div>
      )}

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
