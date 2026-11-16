import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Circle, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import { DomEvent } from "leaflet";
import { parsePoint, toDecimal, toDms, toMgrs } from "./coords";
import { elevationAt } from "./terrain";

interface LatLngPoint { lat: number; lng: number }
interface PhotonHit { name: string; detail: string; lat: number; lng: number }

/** Place search through Photon (OpenStreetMap). Only the typed text is sent. Biased towards where the map is looking. */
async function searchPlaces(q: string, near: LatLngPoint): Promise<PhotonHit[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lat=${near.lat.toFixed(3)}&lon=${near.lng.toFixed(3)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search returned ${res.status}`);
  const data = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
  return (data.features ?? []).map((f) => {
    const p = f.properties;
    const detail = [p.city, p.state, p.country].filter(Boolean).join(", ");
    return { name: p.name ?? detail ?? "Place", detail, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
  });
}

const box: CSSProperties = {
  position: "absolute",
  top: 10,
  right: "var(--lens-pad-right, 12px)",
  zIndex: 500,
  width: 280,
  maxWidth: "40%",
  padding: 8,
  borderRadius: 8,
  background: "rgba(8, 14, 24, 0.9)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e6edf7",
  fontSize: 11,
  fontFamily: "inherit",
};

/** Rings drawn round a pinned point. 5 and 15 km are the distances at which a fire detection counts as backing a report, or as worth checking. */
const RING_CHOICES_KM = [5, 15, 60];

/** Search box, live cursor readout (decimal, degrees-minutes-seconds and MGRS), and a pin on right-click with its height and distance rings. Children are extra tools shown in the same box. */
export function MapSearchPanel({ children }: { children?: ReactNode }) {
  const map = useMap();
  const [cursor, setCursor] = useState<LatLngPoint | null>(null);
  const [pinned, setPinned] = useState<LatLngPoint | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PhotonHit[]>([]);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState("");
  const [height, setHeight] = useState<number | null | undefined>(undefined);
  const [rings, setRings] = useState<number[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Clicks and scrolling inside the box stay in the box, and do not pan, zoom or draw on the map under it.
  useEffect(() => {
    if (!boxRef.current) return;
    DomEvent.disableClickPropagation(boxRef.current);
    DomEvent.disableScrollPropagation(boxRef.current);
  }, []);

  // Ground height at the pinned point.
  useEffect(() => {
    setHeight(undefined);
    if (!pinned) return;
    let cancelled = false;
    elevationAt(pinned.lat, pinned.lng).then((h) => !cancelled && setHeight(h));
    return () => {
      cancelled = true;
    };
  }, [pinned]);

  useMapEvents({
    mousemove: (e) => setCursor({ lat: e.latlng.lat, lng: e.latlng.lng }),
    contextmenu: (e) => setPinned({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });

  // Debounced place search. Typed coordinates fly straight to the point instead.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || parsePoint(q)) {
      setResults([]);
      setStatus("");
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      setStatus("Searching…");
      searchPlaces(q, { lat: map.getCenter().lat, lng: map.getCenter().lng })
        .then((hits) => {
          if (cancelled) return;
          setResults(hits);
          setStatus(hits.length ? "" : "No places found");
        })
        .catch(() => !cancelled && (setResults([]), setStatus("Search unavailable right now")));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, map]);

  const go = (lat: number, lng: number) => {
    map.flyTo([lat, lng], Math.max(map.getZoom(), 8), { duration: 0.8 });
    setPinned({ lat, lng });
  };

  const submit = () => {
    const point = parsePoint(query);
    if (point) go(point.lat, point.lng);
    else if (results[0]) go(results[0].lat, results[0].lng);
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1200);
    } catch {
      setStatus("Copy was blocked by the browser");
    }
  };

  return (
    <>
      <div ref={boxRef} role="search" aria-label="Map search, coordinates and tools" style={{ ...box, maxHeight: "calc(100% - 150px)", overflowY: "auto" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Place, lat, lng or MGRS"
          aria-label="Search places or paste coordinates"
          style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 5, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#e6edf7", fontFamily: "inherit", fontSize: 11 }}
        />
        {status && <div style={{ opacity: 0.7, marginTop: 4 }}>{status}</div>}
        {results.length > 0 && (
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
            {results.map((r, i) => (
              <button
                key={`${r.lat}:${r.lng}:${i}`}
                onClick={() => go(r.lat, r.lng)}
                style={{ textAlign: "left", padding: "4px 6px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "none", color: "#e6edf7", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}
              >
                <b>{r.name}</b>
                {r.detail && <span style={{ opacity: 0.65 }}> · {r.detail}</span>}
              </button>
            ))}
          </div>
        )}
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.1)", fontFamily: "monospace", fontSize: 10.5, lineHeight: 1.5 }}>
          {cursor ? (
            <>
              <div>Cursor {toDecimal(cursor.lat, cursor.lng)}</div>
              <div style={{ opacity: 0.75 }}>{toDms(cursor.lat, cursor.lng)}</div>
              <div style={{ opacity: 0.75 }}>{toMgrs(cursor.lat, cursor.lng)}</div>
            </>
          ) : (
            <div style={{ opacity: 0.6 }}>Move over the map for coordinates. Right-click to pin a point.</div>
          )}
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => copy(window.location.href, "link")} style={{ padding: "3px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", color: "#e6edf7", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 5 }} title="The link reopens this place, day and imagery">
            {copied === "link" ? "Link copied" : "Copy link to this view"}
          </button>
        </div>
        {children}
      </div>
      {pinned && rings.map((km) => (
        <Circle key={km} center={[pinned.lat, pinned.lng]} radius={km * 1000} interactive={false} pathOptions={{ color: "#ffffff", weight: 1.2, dashArray: "5 5", fill: false }} />
      ))}
      {pinned && (
        <CircleMarker center={[pinned.lat, pinned.lng]} radius={5} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#ff7a1a", fillOpacity: 1 }}>
          <Popup>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#0b1220" }}>
              <div><b>Pinned point</b></div>
              <div>{toDecimal(pinned.lat, pinned.lng)}</div>
              <div>{toDms(pinned.lat, pinned.lng)}</div>
              <div>{toMgrs(pinned.lat, pinned.lng)}</div>
              <div>Height: {height === undefined ? "reading…" : height === null ? "unavailable" : `${Math.round(height)} m above sea level`}</div>
              <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button onClick={() => copy(toDecimal(pinned.lat, pinned.lng), "decimal")} style={{ padding: "3px 8px", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>
                  {copied === "decimal" ? "Copied" : "Copy decimal"}
                </button>
                <button onClick={() => copy(toMgrs(pinned.lat, pinned.lng), "mgrs")} style={{ padding: "3px 8px", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>
                  {copied === "mgrs" ? "Copied" : "Copy MGRS"}
                </button>
              </div>
              <div style={{ marginTop: 6 }}>Rings:{" "}
                {RING_CHOICES_KM.map((km) => (
                  <label key={km} style={{ marginRight: 8 }}>
                    <input type="checkbox" checked={rings.includes(km)} onChange={(e) => setRings((r) => (e.target.checked ? [...r, km] : r.filter((x) => x !== km)))} /> {km} km
                  </label>
                ))}
              </div>
            </div>
          </Popup>
        </CircleMarker>
      )}
    </>
  );
}
