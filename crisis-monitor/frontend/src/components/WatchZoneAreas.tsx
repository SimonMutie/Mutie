import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, Tooltip } from "react-leaflet";
import { Popup as GlPopup, type ExpressionSpecification, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import type { MultiPolygon } from "geojson";
import { api, type WatchZone } from "../api";
import { buildWatchZoneAreas, labelPoint, ZONE_STYLE } from "../watchZoneAreas";
import { firstDataLayer } from "./globeExtras";

/**
 * Watch zones drawn as areas (watchZoneAreas.ts) on both views: each zone filled and outlined in its severity's
 * colour (active war red, high tension orange, elevated amber and dashed), named in capitals, and opening its
 * details on click: what it is, how many reports and escalation incidents fall in it, and the latest report.
 */

export function useWatchZoneAreas(on: boolean) {
  const [zones, setZones] = useState<WatchZone[]>([]);
  const [areas, setAreas] = useState<Record<string, MultiPolygon>>({});
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () =>
      api
        .getWatchZones()
        .then(async (r) => {
          if (!live) return;
          setZones(r.zones);
          const built = await buildWatchZoneAreas(r.zones);
          if (live) setAreas(built);
        })
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on]);
  return { zones: on ? zones : [], areas };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function detailsHtml(z: WatchZone): string {
  const st = ZONE_STYLE[z.severity];
  const latest = z.headlines[0];
  return `<div style="max-width:300px;font-size:12.5px;line-height:1.45">
  <div style="font-weight:800;letter-spacing:.04em;color:${st.color}">${esc(z.label)}</div>
  <div style="font-weight:600;margin-bottom:4px">${st.label}</div>
  <div>${esc(z.description)}</div>
  <div style="margin-top:6px;opacity:.85">${z.headlineCount} recent report${z.headlineCount === 1 ? "" : "s"} · ${z.incidents.length} escalation incident${z.incidents.length === 1 ? "" : "s"} in the zone</div>
  ${latest ? `<div style="margin-top:6px">Latest: <a href="${esc(latest.url)}" target="_blank" rel="noreferrer">${esc(latest.title)}</a> <span style="opacity:.7">(${esc(latest.source)})</span></div>` : ""}
  <div style="margin-top:6px;font-size:11px;opacity:.65">Severity is an Afrilens editorial rating of the standing situation, not a live measurement.</div>
</div>`;
}

export function FlatWatchZones({ zones, areas }: { zones: WatchZone[]; areas: Record<string, MultiPolygon> }) {
  return (
    <>
      {zones
        .filter((z) => areas[z.id])
        .map((z) => {
          const st = ZONE_STYLE[z.severity];
          return (
            <GeoJSON
              key={`${z.id}:${z.severity}:${z.headlineCount}`}
              data={{ type: "Feature", properties: {}, geometry: areas[z.id] } as never}
              style={{ color: st.color, weight: st.weight, dashArray: st.dash, opacity: 0.9, fillColor: st.color, fillOpacity: st.fill }}
              onEachFeature={(_f, layer) => layer.bindPopup(detailsHtml(z), { maxWidth: 320 })}
            >
              <Tooltip sticky>{`${z.label} · ${st.label}`}</Tooltip>
            </GeoJSON>
          );
        })}
    </>
  );
}

export function GlobeWatchZones({ map, zones, areas }: { map: MapLibreMap | null; zones: WatchZone[]; areas: Record<string, MultiPolygon> }) {
  const byId = useRef<Record<string, WatchZone>>({});
  byId.current = Object.fromEntries(zones.map((z) => [z.id, z]));
  const data = useMemo(() => {
    const shown = zones.filter((z) => areas[z.id]);
    return {
      areas: { type: "FeatureCollection" as const, features: shown.map((z) => ({ type: "Feature" as const, properties: { id: z.id, severity: z.severity, color: ZONE_STYLE[z.severity].color }, geometry: areas[z.id] })) },
      labels: { type: "FeatureCollection" as const, features: shown.map((z) => ({ type: "Feature" as const, properties: { id: z.id, label: z.label, color: ZONE_STYLE[z.severity].color }, geometry: { type: "Point" as const, coordinates: labelPoint(z, areas[z.id]) } })) },
    };
  }, [zones, areas]);
  const popupRef = useRef<GlPopup | null>(null);

  useEffect(() => {
    if (!map) return;
    if (!map.getSource("lens-zones")) {
      const before = firstDataLayer(map);
      map.addSource("lens-zones", { type: "geojson", data: data.areas as never });
      map.addSource("lens-zone-labels", { type: "geojson", data: data.labels as never });
      const fill = ["match", ["get", "severity"], "war", ZONE_STYLE.war.fill, "high", ZONE_STYLE.high.fill, ZONE_STYLE.elevated.fill] as unknown as ExpressionSpecification;
      map.addLayer({ id: "lens-control-zones-fill", type: "fill", source: "lens-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": fill } }, before);
      for (const sev of ["war", "high", "elevated"] as const) {
        const st = ZONE_STYLE[sev];
        map.addLayer(
          { id: `lens-control-zones-line-${sev}`, type: "line", source: "lens-zones", filter: ["==", ["get", "severity"], sev], paint: { "line-color": st.color, "line-width": st.weight, "line-opacity": 0.9, ...(st.glDash ? { "line-dasharray": st.glDash } : {}) } },
          before
        );
      }
      map.addLayer(
        {
          id: "lens-control-zones-label",
          type: "symbol",
          source: "lens-zone-labels",
          minzoom: 2.5,
          layout: { "text-field": ["get", "label"], "text-size": 11, "text-letter-spacing": 0.08, "text-font": ["Noto Sans Bold", "Open Sans Bold"], "text-allow-overlap": false },
          paint: { "text-color": ["get", "color"], "text-halo-color": "#05080f", "text-halo-width": 1.6 },
        },
        before
      );
      map.on("click", "lens-control-zones-fill", (e: MapLayerMouseEvent) => {
        // Markers on top take their own clicks first.
        const above = map.queryRenderedFeatures(e.point).find((f) => f.layer.id.startsWith("lens-") && !f.layer.id.startsWith("lens-control-") && !f.layer.id.startsWith("lens-basemap-") && f.layer.type !== "fill");
        if (above) return;
        const z = byId.current[e.features?.[0]?.properties?.id as string];
        if (!z) return;
        popupRef.current?.remove();
        popupRef.current = new GlPopup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(detailsHtml(z)).addTo(map);
      });
    } else {
      (map.getSource("lens-zones") as GeoJSONSource).setData(data.areas as never);
      (map.getSource("lens-zone-labels") as GeoJSONSource).setData(data.labels as never);
    }
  }, [map, data]);
  return null;
}
