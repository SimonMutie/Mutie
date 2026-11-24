import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Marker, ScaleControl, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import L, { type Map as LeafletMap } from "leaflet";
import { parsePoint, toDecimal, toDms, toMgrs } from "../coords";
import { circleRingLngLat, fmtKm, type LL } from "./gisMath";

/** A ring drawn on both maps: a buffer round a feature, or a distance ring round a pinned point. */
export interface GisRing { lat: number; lng: number; km: number; label?: string; color?: string }

const RING_KM = [5, 15, 60];
const SRC = "lens-gis-rings";

const box: CSSProperties = {
  position: "absolute",
  left: "calc(var(--lens-pad-left, 12px) + 4px)",
  bottom: 78,
  zIndex: 6,
  padding: "6px 8px",
  borderRadius: 8,
  background: "rgba(8, 14, 24, 0.88)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e6edf7",
  fontSize: 11,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  lineHeight: 1.45,
  maxWidth: 300,
};
const btn: CSSProperties = { padding: "2px 7px", fontSize: 10.5, fontFamily: "inherit", cursor: "pointer", background: "rgba(255,255,255,0.08)", color: "#e6edf7", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 4 };

function ringsFc(rings: GisRing[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rings.map((r) => ({
      type: "Feature",
      properties: { color: r.color ?? "#3fd0ff", label: r.label ?? fmtKm(r.km) },
      geometry: { type: "Polygon", coordinates: [circleRingLngLat(r, r.km)] },
    })),
  };
}

/**
 * GIS readout for the 3D globe: the cursor's position in decimal degrees, degrees-minutes-seconds and MGRS; a
 * metric and imperial scale bar; right-click (without dragging) to pin a point, copy its coordinates and draw
 * distance rings round it; and a box to go to a coordinate typed or pasted in either format. `rings` are extra
 * rings to draw, such as buffers round features from the attribute table.
 */
export function GlobeGisOverlay({ map, rings }: { map: MapLibreMap | null; rings: GisRing[] }) {
  const [cursor, setCursor] = useState<LL | null>(null);
  const [pinned, setPinned] = useState<LL | null>(null);
  const [ringOn, setRingOn] = useState<number[]>([]);
  const [goto, setGoto] = useState("");
  const [gotoErr, setGotoErr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const marker = useRef<Marker | null>(null);

  // Cursor readout and right-click pin. A right-drag rotates the globe, so only a click that did not move pins.
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    let down: { x: number; y: number } | null = null;
    const move = (e: { lngLat: { lat: number; lng: number } }) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCursor({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    };
    const out = () => setCursor(null);
    const onDown = (e: MouseEvent) => { if (e.button === 2) down = { x: e.clientX, y: e.clientY }; };
    const ctx = (e: { lngLat: { lat: number; lng: number }; originalEvent: MouseEvent }) => {
      const o = e.originalEvent;
      if (down && Math.hypot(o.clientX - down.x, o.clientY - down.y) > 4) return;
      setPinned({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    const canvas = map.getCanvasContainer();
    map.on("mousemove", move);
    map.on("mouseout", out);
    map.on("contextmenu", ctx);
    canvas.addEventListener("mousedown", onDown);
    const metric = new ScaleControl({ maxWidth: 130, unit: "metric" });
    const imperial = new ScaleControl({ maxWidth: 130, unit: "imperial" });
    map.addControl(metric, "bottom-left");
    map.addControl(imperial, "bottom-left");
    return () => {
      cancelAnimationFrame(frame);
      map.off("mousemove", move);
      map.off("mouseout", out);
      map.off("contextmenu", ctx);
      canvas.removeEventListener("mousedown", onDown);
      try { map.removeControl(metric); map.removeControl(imperial); } catch { /* map gone */ }
    };
  }, [map]);

  // Pin marker.
  useEffect(() => {
    if (!map) return;
    marker.current?.remove();
    marker.current = null;
    if (pinned) {
      const el = document.createElement("div");
      el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#3fd0ff;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.45)";
      marker.current = new Marker({ element: el }).setLngLat([pinned.lng, pinned.lat]).addTo(map);
    }
    return () => { marker.current?.remove(); };
  }, [map, pinned]);

  // Rings: the pinned point's distance rings and any buffers passed in.
  const all: GisRing[] = [...(pinned ? ringOn.map((km) => ({ ...pinned, km, color: "#3fd0ff" })) : []), ...rings];
  const sig = JSON.stringify(all);
  useEffect(() => {
    if (!map) return;
    const data = ringsFc(all);
    const apply = () => {
      const src = map.getSource(SRC) as GeoJSONSource | undefined;
      if (src) { src.setData(data); return; }
      map.addSource(SRC, { type: "geojson", data });
      map.addLayer({ id: `${SRC}-fill`, type: "fill", source: SRC, paint: { "fill-color": ["get", "color"], "fill-opacity": 0.06 } });
      map.addLayer({ id: `${SRC}-line`, type: "line", source: SRC, paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [3, 2] } });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig]);
  useEffect(() => () => {
    if (!map) return;
    try {
      for (const id of [`${SRC}-line`, `${SRC}-fill`]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SRC)) map.removeSource(SRC);
    } catch { /* style changed */ }
  }, [map]);

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(null), 1200); }, () => {});
  };
  const go = () => {
    const p = parsePoint(goto);
    setGotoErr(!p);
    if (!p || !map) return;
    setPinned(p);
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 9), duration: 1100 });
  };

  if (!map) return null;
  if (collapsed) {
    return (
      <button style={{ ...box, ...btn, padding: "4px 8px" }} onClick={() => setCollapsed(false)} title="Show coordinates">
        ⌖ Coordinates
      </button>
    );
  }
  return (
    <div style={box} onContextMenu={(e) => e.preventDefault()}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 2 }}>
        <span style={{ fontSize: 9.5, letterSpacing: "0.08em", color: "#8fa3bf" }}>WGS 84 · CURSOR</span>
        <button style={{ ...btn, padding: "0 5px" }} onClick={() => setCollapsed(true)} title="Hide">–</button>
      </div>
      {cursor ? (
        <>
          <div>{toDecimal(cursor.lat, cursor.lng)}</div>
          <div style={{ opacity: 0.75 }}>{toDms(cursor.lat, cursor.lng)}</div>
          <div style={{ opacity: 0.75 }}>{toMgrs(cursor.lat, cursor.lng) || "MGRS n/a"}</div>
        </>
      ) : (
        <div style={{ opacity: 0.6 }}>Move over the map. Right-click to pin a point.</div>
      )}
      <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
        <input
          value={goto}
          onChange={(e) => { setGoto(e.target.value); setGotoErr(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          placeholder="Go to: -1.29, 36.82 or 37M BU 12345 67890"
          style={{ flex: 1, minWidth: 0, padding: "3px 6px", fontFamily: "inherit", fontSize: 10.5, background: "rgba(0,0,0,0.35)", color: "#e6edf7", border: `1px solid ${gotoErr ? "#ff6b6b" : "rgba(255,255,255,0.16)"}`, borderRadius: 4 }}
        />
        <button style={btn} onClick={go}>Go</button>
      </div>
      {pinned && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontSize: 9.5, letterSpacing: "0.08em", color: "#3fd0ff" }}>PINNED</div>
          <div>{toDecimal(pinned.lat, pinned.lng)}</div>
          <div>{toDms(pinned.lat, pinned.lng)}</div>
          <div>{toMgrs(pinned.lat, pinned.lng)}</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            <button style={btn} onClick={() => copy(toDecimal(pinned.lat, pinned.lng), "dd")}>{copied === "dd" ? "Copied" : "Copy DD"}</button>
            <button style={btn} onClick={() => copy(toDms(pinned.lat, pinned.lng), "dms")}>{copied === "dms" ? "Copied" : "Copy DMS"}</button>
            <button style={btn} onClick={() => copy(toMgrs(pinned.lat, pinned.lng), "mgrs")}>{copied === "mgrs" ? "Copied" : "Copy MGRS"}</button>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
            <span style={{ opacity: 0.7 }}>Rings:</span>
            {RING_KM.map((km) => (
              <button key={km} style={{ ...btn, background: ringOn.includes(km) ? "rgba(63,208,255,0.25)" : btn.background }} onClick={() => setRingOn((r) => (r.includes(km) ? r.filter((x) => x !== km) : [...r, km]))}>
                {km} km
              </button>
            ))}
            <button style={btn} onClick={() => { setPinned(null); setRingOn([]); }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The flat map's scale bar (metric and imperial) and the attribute table's buffer rings, drawn on the Leaflet map. */
export function useFlatGis(map: LeafletMap | null, rings: GisRing[]) {
  useEffect(() => {
    if (!map) return;
    const scale = L.control.scale({ position: "bottomleft", metric: true, imperial: true, maxWidth: 140 }).addTo(map);
    return () => { scale.remove(); };
  }, [map]);
  const sig = JSON.stringify(rings);
  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup(
      rings.map((r) =>
        L.polygon(circleRingLngLat(r, r.km).map(([lng, lat]) => [lat, lng] as [number, number]), {
          color: r.color ?? "#3fd0ff",
          weight: 1.6,
          dashArray: "6 4",
          fillOpacity: 0.06,
          interactive: false,
        })
      )
    ).addTo(map);
    return () => { group.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig]);
}
