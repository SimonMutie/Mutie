import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import LeafletMapControls from "../LeafletMapControls";
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { QueryMapPoint, QueryOverview } from "../../api";
import { BASEMAPS } from "../mapConstants";
import type { Map3DPoint, Map3DSelectedFeature } from "../Map3D";
import { Empty, Panel, TONE_COLOR, exactTime, timeAgo, toneOf } from "./shared";

/**
 * The query's items on a map that zooms and pans, with the same choice of
 * maps as Live OSINT: a 3D globe, a dark 2D map, a street map and satellite
 * imagery. Each item is placed where its own headline and text say it is;
 * an item that names nowhere is counted in the panel's note, never drawn in
 * a guessed position.
 */

// The 3D engine is large; it is only fetched when the globe is chosen.
const Map3D = lazy(() => import("../Map3D"));
const Map3DDetailPanel = lazy(() => import("../Map3D").then((m) => ({ default: m.Map3DDetailPanel })));

type Mode = "3d" | "2d" | "map" | "sat";
const MODES: { key: Mode; label: string; title: string }[] = [
  { key: "3d", label: "3D", title: "3D globe" },
  { key: "2d", label: "2D", title: "Dark flat map" },
  { key: "map", label: "Map", title: "Street map" },
  { key: "sat", label: "Sat", title: "Satellite imagery" },
];
const MODE_KEY = "lens.queryDashboard.mapMode";
const MARKER = "#f0a93b"; // one colour for every item: on a dark, a street and a satellite base alike

const isWebUrl = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

function storedMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "3d" || m === "2d" || m === "map" || m === "sat") return m;
  } catch {
    // storage unavailable: the default applies
  }
  return "3d";
}

/** `fitKey` names the query and period on show: the flat maps frame the items once each time it changes. */
export default function MapPanel({ overview, fitKey }: { overview: QueryOverview | null; fitKey: string }) {
  const [mode, setModeState] = useState<Mode>(storedMode);
  const [selected, setSelected] = useState<Map3DSelectedFeature | null>(null);
  const points = overview?.points ?? [];

  function setMode(m: Mode) {
    setModeState(m);
    setSelected(null);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // not remembered; the choice still applies now
    }
  }

  // The globe draws one marker per place, sized by how many items name it; the flat maps cluster instead.
  const globePoints = useMemo<Map3DPoint[]>(() => {
    const byPlace = new Map<string, QueryMapPoint[]>();
    for (const p of points) {
      const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      byPlace.set(key, [...(byPlace.get(key) ?? []), p]);
    }
    const most = Math.max(1, ...[...byPlace.values()].map((g) => g.length));
    return [...byPlace.entries()].map(([key, group]) => ({
      id: `q-${key}`,
      layerKey: "Query items",
      lat: group[0].lat,
      lng: group[0].lon,
      color: MARKER,
      size: 0.12 + 0.3 * Math.sqrt(group.length / most),
      title: `${group[0].place ?? "Unnamed place"} · ${group.length} item${group.length === 1 ? "" : "s"}`,
      subtitle: group
        .slice(0, 4)
        .map((p) => `• ${p.title}`)
        .join("\n"),
      time: group[0].published_at,
      url: group[0].url,
    }));
  }, [points]);

  const note = overview ? (overview.sampled.total === 0 ? undefined : `${overview.located.toLocaleString()} of ${overview.sampled.used.toLocaleString()} items name a place`) : undefined;

  return (
    <Panel
      title="Map"
      note={note}
      bodyStyle={{ padding: 0 }}
      actions={
        <div className="qd-seg" role="group" aria-label="Map type">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={mode === m.key ? "is-on" : ""} aria-pressed={mode === m.key} title={m.title} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="qd-map">
        {mode === "3d" ? (
          <Suspense fallback={<Empty>Loading the globe…</Empty>}>
            <Map3D
              points={globePoints}
              fitKey={fitKey}
              paths={[]}
              territoryChanges={[]}
              drawAreaRing={null}
              onFeatureSelect={setSelected}
              showDayNight={false}
              showBuildings={false}
              showTerrain={false}
            />
            <Map3DDetailPanel feature={selected} onClose={() => setSelected(null)} />
          </Suspense>
        ) : (
          <FlatMap mode={mode} points={points} fitKey={fitKey} />
        )}
        {overview && points.length === 0 && <div className="qd-map__empty">{overview.total === 0 ? "Nothing was collected in this period." : "None of the items in this period names a place."}</div>}
      </div>
    </Panel>
  );
}

function FlatMap({ mode, points, fitKey }: { mode: Exclude<Mode, "3d">; points: QueryMapPoint[]; fitKey: string }) {
  const tile = mode === "sat" ? BASEMAPS.esriImagery : mode === "map" ? BASEMAPS.osm : BASEMAPS.dark;
  return (
    <MapContainer center={[4, 22]} zoom={3} minZoom={2} worldCopyJump scrollWheelZoom zoomControl={false} style={{ height: "100%", width: "100%", background: mode === "map" ? "#dfe5ec" : "#05070d" }}>
      <LeafletMapControls />
      <TileLayer key={mode} url={tile.url} attribution={tile.attribution} />
      <KeepSized />
      <FitTo points={points} fitKey={fitKey} />
      <MarkerClusterGroup chunkedLoading maxClusterRadius={46} spiderfyOnMaxZoom showCoverageOnHover={false}>
        {points.map((p) => (
          <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={7} pathOptions={{ color: "#ffffff", weight: 2, fillColor: MARKER, fillOpacity: 0.95 }}>
            <Tooltip direction="top" offset={[0, -6]}>
              {p.title}
            </Tooltip>
            <Popup maxWidth={320}>
              <div className="qd-popup">
                <div className="qd-popup__meta">
                  {p.place} · <span title={exactTime(p.published_at)}>{timeAgo(p.published_at)}</span>
                </div>
                <div className="qd-popup__title">
                  {isWebUrl(p.url) ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.title} ↗
                    </a>
                  ) : (
                    p.title
                  )}
                </div>
                {p.snippet && <div className="qd-popup__text">{p.snippet}</div>}
                <div className="qd-popup__meta">
                  {p.kind === "event" ? "Event" : "Conversation"}
                  {p.source && ` · ${p.source}`} ·{" "}
                  <span className="qd-tone">
                    <i style={{ background: TONE_COLOR[toneOf(p.sentiment)] }} />
                    {toneOf(p.sentiment)} tone
                  </span>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}

/** A map inside a panel that is being resized has to be told its new size. */
function KeepSized() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Frames the items once for each query and period — not on every refresh, so it never fights the viewer's own zooming. */
function FitTo({ points, fitKey }: { points: QueryMapPoint[]; fitKey: string }) {
  const map = useMap();
  const fitted = useRef<string | null>(null);
  const ready = points.length > 0;
  useEffect(() => {
    if (!ready || fitted.current === fitKey) return;
    fitted.current = fitKey;
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)],
      ],
      { padding: [36, 36], maxZoom: 7, animate: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, ready]);
  return null;
}
