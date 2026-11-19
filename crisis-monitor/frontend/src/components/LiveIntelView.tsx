import { exportAllowed, stampCanvas } from "../exportGuard";
import { MarketsPanel } from "./MarketsPanel";
import { EconomyPanel } from "./EconomyPanel";
import { STANDING_HOTSPOTS } from "../standingHotspots";
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapCompass } from "./LeafletMapControls";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { MapContainer, TileLayer, CircleMarker, GeoJSON, Marker, Polygon, Polyline, Popup as LeafletPopup, Tooltip as LeafletTooltip, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { StudioLayer } from "../studio/StudioLayer";
import { Studio3D } from "../studio/Studio3D";
import { NearbySearch, type NearbyState } from "../studio/NearbySearch";
import { RouteStyleControls } from "../studio/RouteStyleControls";
import { DEFAULT_ROUTE_STYLE, type RouteStyle } from "../studio/hud";
import { bufferFeature } from "../studio/store";
import { EditablePoints, EditablePoints3D, type EditPoint } from "../studio/EditablePoints";
import type { Map as MapLibreMap } from "maplibre-gl";
import { StudioPanel } from "../studio/StudioPanel";
import { createShape, DEFAULT_STYLE, studio, useStudio } from "../studio/store";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { IncidentMarker, classifyActor, type PopupAnnotation, totalCasualties, MonthQuickFilter } from "./IncidentsMap";
import { classifyIncident } from "./actorTheme";
import NavPad from "./MapNavPad";
import { setAlertsPaused, useAlertsPaused } from "../alertPrefs";
import { HeatmapLayer, DEFAULT_HEATMAP_STYLE, incidentHeatPoints, type HeatmapStyle } from "./HeatmapLayer";
import { HeatmapControls } from "./HeatmapControls";
import { useHiddenIncidents, HiddenIncidentsControl, type HiddenIncidents } from "./hiddenIncidents";
import {
  Activity,
  AlertTriangle,
  CloudRain,
  Wind,
  Thermometer,
  X,
  Cloud,
  WifiOff,
  Crosshair,
  Anchor,
  Bell,
  Bug,
  Building2,
  Cable,
  ClipboardList,
  CloudLightning,
  Flame,
  Hexagon,
  Flag,
  Landmark,
  HeartPulse,
  HeartHandshake,
  LineChart,
  MapPin,
  Megaphone,
  BellOff,
  Mountain,
  Download,
  Navigation,
  Network,
  Newspaper,
  Send,
  Plane,
  Radar,
  Radiation,
  Radio,
  RefreshCw,
  Route as RouteGlyph,
  Rss,
  Ruler,
  Satellite,
  Globe,
  Square,
  Map as MapIcon,
  Search as SearchGlyph,
  Shield,
  Ship,
  Siren,
  Sun,
  ZoomIn,
  Layers,
  Telescope,
  TrendingDown,
  TrendingUp,
  Tv,
  Upload as UploadGlyph,
  Wallet,
  Waypoints,
  X as CloseGlyph,
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  type LucideIcon,
  BrainCircuit,
} from "lucide-react";
import Map3D, { Map3DDetailPanel, type Map3DPath, type Map3DTerritoryChange, type Map3DSelectedFeature } from "./Map3D";
import { liveuamapLink, openLiveuamap } from "../liveuamap";
import EscalationHoverCard from "./EscalationHoverCard";
import {
  api,
  type LiveLayerCollection,
  type FireHistoryDays,
  type LiveLayerFeature,
  type IssPosition,
  type RouteProfile,
  type RouteResult,
  type SpaceWeather,
  type CyberThreats,
  type MarketsStatus,
  type ActiveCountry,
  type ConflictWave,
  type IncidentPulse,
  type SituationEvent,
  type AircraftTrack,
  type ActivityIndex,
  type IncidentItem,
  type IncidentFilters as IncidentFilterOptions,
  type SavedShape,
  type SavedRoute,
  type EconomicIndicators,
  type SocialListeningResult,
  type SavedListeningQuery,
  type WalletIntel,
  type ChainKind,
  type OsintAlertItem,
  type LiveBroadcast,
  type EscalationIncident,
  type MonitoringQueryItem,
  type LocatedMonitoringResult,
} from "../api";
import { loadMonitorLayerIds, saveMonitorLayerIds } from "../monitorLayers";
import ConflictIntensityLegend from "./ConflictIntensityLegend";
import FireTimeline, { FireMapLayer, fireRangeFrom, unusualFireDays, type FireRangeMode } from "./FireTimeline";
import { DEFAULT_IMAGERY, IMAGERY_KEYS, ImageryControl, clampImageryDay, compareDay, imageryTemplate, type ImageryKey, type ImageryState } from "./ImageryOverlays";
import { BeforeAfterLens, FireDownload, SunShadowTool, TerrainProfile, ViewPermalink, readViewParams } from "./MapTools";
import { IncidentPulseLayer, pulsesAsWaves, useIncidentPulses } from "./IncidentPulses";
import { ConnectivityLayer, ConnectivityPanel, useConnectivity } from "./Connectivity";
import { RegionBar, HornOutlines, HotspotWaves, RegionFly, hotCellsFrom, type RegionView } from "./RegionControls";
import { MapSearchPanel } from "./MapSearch";
import { GLOBE_WEATHER, GlobeWeather, type GlobeWeatherKind } from "./GlobeWeather";
import TelegramPanel from "./TelegramPanel";
import SituationPanel from "./SituationPanel";
import AfrIntelPanel from "./AfrIntelPanel";
import StrategicAnalysesPanel from "./StrategicAnalysesPanel";
import { maptilerKey, useMapTilerKey, tileOptions } from "../mapProvider";
import { BASEMAP_IDS, basemapStyleId, liveBasemap, liveBasemaps, type BasemapId } from "../liveBasemaps";
import type { AfrIntelRun } from "../api";
import LiveAlertsPanel from "./LiveAlertsPanel";
import { WeatherTiles, useRainViewer } from "./WeatherTiles";
import FlightCard, { type SelectedAircraft } from "./FlightCard";
import { AircraftMarkers } from "./AircraftMarkers";
import { AIRCRAFT_LAYER_KEYS } from "./planeIcon";
import { activeCountryFeatures, countryPathStyle, countryShadingKey, loadWorldCountries } from "./worldCountries";
import { waveFeatures } from "./conflictWaves";
import "./ConflictWaves.css";
import { divIcon } from "leaflet";
import { dotRadius, DOT, warningIconUrl, WARNING_SIZE, type EscalationLevel } from "./mapSymbols";
import type { FeatureCollection } from "geojson";
import { BASEMAPS } from "./mapConstants";
// Lazy — IncidentUpload pulls in the xlsx parser (400+ KB), not worth
// loading for every visit to this view when the intake modal may never
// open (same lazy-load pattern DashboardWidgetCard already uses for
// RouteDrawingGlobe/LabelDrawingGlobe).
const IncidentManualEntry = lazy(() => import("./IncidentManualEntry"));
const IncidentUpload = lazy(() => import("./IncidentUpload"));
const IncidentReview = lazy(() => import("./IncidentReview"));

/**
 * The reference platform's real visual language — checked directly against its open-source
 * repo (github.com/enzg/lens-live, src/app/globals.css): a gold "Eye of
 * Horus" accent on a near-black glass panel, JetBrains Mono throughout,
 * uppercase/tracked headers, not the blue HUD palette this view launched
 * with. Kept as local constants (not pushed into the app's shared
 * globals.css) so this one view's restyle can't leak into any other part
 * of the app. Map/data-point colors (per-layer dot colors, route/draw
 * colors) are deliberately NOT reassigned to this palette — those encode
 * real data (layer identity, alert severity) and the reference platform's own layer dots
 * are similarly varied per-layer, not all forced to one accent color.
 */
const HUD = {
  bgPanel: "rgba(8, 10, 20, 0.88)",
  borderPrimary: "rgba(212, 175, 55, 0.15)",
  borderPrimaryHover: "rgba(212, 175, 55, 0.22)",
  gold: "#D4AF37",
  goldLight: "#F0D060",
  cyan: "#00E5FF",
  textPrimary: "#E8E6E0",
  textSecondary: "#9B978E",
  textMuted: "#5C5A54",
  alertRed: "#FF3D3D",
  alertOrange: "#FF9500",
  alertGreen: "#00E676",
  alertBlue: "#448AFF",
} as const;

const HUD_PANEL_SHADOW = "0 4px 30px rgba(0,0,0,0.5), 0 1px 0 rgba(212,175,55,0.06) inset, 0 -1px 0 rgba(0,0,0,0.3) inset";

/** Every field the Incidents tool's search can filter on — the same 15
 *  categorical fields IncidentSearch's full-page search offers, plus a
 *  date-of-occurrence range. Mirrors api.getIncidents' own params so any
 *  key here can be spread straight into that call. */
type IncidentFilterState = {
  country?: string;
  province?: string;
  county?: string;
  district?: string;
  city?: string;
  suburb?: string;
  sector?: string;
  actor?: string;
  tactic?: string;
  severity?: string;
  operation?: string;
  target?: string;
  interest_group?: string;
  actual_main_victim?: string;
  intended_primary_target?: string;
  from?: string;
  to?: string;
};

/** A glass-panel container, the reference platform's own .glass-panel rule ported to inline
 *  styles (blur+saturate backdrop, gold hairline border, layered shadow,
 *  14px corners) — every floating HUD card in this view is built on this. */
function glassPanel(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: HUD.bgPanel,
    backdropFilter: "blur(24px) saturate(1.3)",
    WebkitBackdropFilter: "blur(24px) saturate(1.3)",
    border: `1px solid ${HUD.borderPrimary}`,
    borderRadius: 14,
    boxShadow: HUD_PANEL_SHADOW,
    ...extra,
  };
}


/**
 * "Live OSINT" — a new, separate view rather than a restyle of the
 * existing (light) dashboards/choropleth. Modeled on the reference platform's own dark HUD
 * aesthetic: a grouped, toggleable layer panel on the left,
 * a rotating 3D globe (or a flat 2D/Map/Sat projection, switchable) with
 * crisp country-level boundary lines, and monospace status readouts.
 * Nothing here touches IncidentsMap/IncidentSearch or their data.
 *
 * The 3D globe deliberately does NOT use a photographic/satellite Earth
 * texture — that's a "Sat" look, and the reference platform's own 3D view is a dark
 * data-vis map (flat black sphere, thin white national borders, a subtle
 * lat/lng graticule), not imagery. Country outlines come from the same
 * world-atlas topology already bundled for the choropleth/GlobeWidget
 * elsewhere in this app (world-atlas/countries-110m.json), rendered as
 * three-globe polygons with a transparent fill and a visible stroke only —
 * "Sat" as an actual satellite photo basemap is reserved for the flat 2D
 * mode switcher below, matching what the reference platform's own 3D/2D/Map/Sat buttons do.
 *
 * Layer sourcing, and why each one either is or isn't here:
 *  - Earthquakes / Active Fires / Severe Weather / GDELT Events / Air
 *    Traffic / Satellites: real public feeds (USGS, NASA EONET, GDELT,
 *    OpenSky, CelesTrak), proxied and normalized by the backend's
 *    /api/live-layers gateway.
 *  - Nuclear Facilities: another static reference dataset, same idea as
 *    Maritime below — real operating nuclear power stations worldwide
 *    (Wikipedia's list, itself drawn from the IAEA's PRIS registry), not a
 *    live sensor feed, since nothing here changes minute to minute anyway.
 *  - Global Incidents: the reference platform's real flyout pairs this with GDELT Events,
 *    and ACLED would be the obvious real source — but its EULA explicitly
 *    bars a commercial entity from using it in the entity's own dashboard
 *    without a paid corporate license (checked directly against
 *    acleddata.com/eula), which is exactly this app's situation. This is a
 *    second, deliberately broader GDELT query instead — real, keyless, no
 *    licensing conflict, just covering more than armed-conflict terms.
 *  - Botnet C2s: abuse.ch's Feodo Tracker — a real, free, keyless,
 *    continuously-updated list of confirmed active botnet
 *    command-and-control servers. Labeled specifically as "Botnet C2s"
 *    rather than a generic "Cyberattacks" layer because that's precisely
 *    what it is: confirmed C2 infrastructure by hosting country (which may
 *    itself be a proxy/bulletproof-hosting jurisdiction), not an
 *    "attack in progress" animation — those vendor map visuals are
 *    illustrative, not live telemetry, and this view only shows real data.
 *    Not one of the reference platform's own Threats & Intel rows, but a legitimate
 *    addition of another already-integrated real feed.
 *  - My Incidents / Live Alert Pins: this account's own data, already
 *    scoped by the backend's normal auth (client/country restrictions
 *    apply exactly as they do everywhere else in the app) — reusing the
 *    existing /api/incidents and /api/alerts endpoints rather than a new
 *    route. Live Alert Pins lives under Threats & Intel (matching the reference platform's
 *    real grouping), not My Data, even though it's the same per-account
 *    alert data "My Alerts" always was.
 *  - Maritime: checked directly against the reference platform's own open-source code
 *    (github.com/enzg/lens-live) rather than assumed to have live AIS —
 *    it turns out the reference platform's "Maritime" layer is itself a static reference
 *    dataset (major ports, naval bases, shipping chokepoints with real
 *    published stats), refreshed once a day, zero external API calls.
 *  - Deliberately NOT included: live CCTV, and the "Recon Toolkit" /
 *    "Marauder" style device-scanning tools the reference platform's own UI shows — those
 *    are active reconnaissance/surveillance capabilities, not data layers,
 *    and this app isn't going to carry them regardless of whether a
 *    backend exists to power them. Submarine cables: a real open dataset
 *    exists but wasn't confirmed reachable in time for this pass.
 *
 * Right-side toolbar — the reference platform shows several of these as its own icon rail;
 * the ones built here are the legitimate, non-reconnaissance subset:
 *  - Drawing Tools: click points on the map to measure a line's distance or
 *    a shape's area, then export the shape as GeoJSON. Pure client-side
 *    geometry (haversine distance, a standard spherical-polygon-area
 *    approximation) — no external API.
 *  - Route: turn-by-turn driving/walking/cycling directions between two
 *    clicked points, via the backend's /route proxy in front of OSRM's free
 *    public demo router (see that route's own comment — it's a demo
 *    instance, not a production SLA).
 *  - Live From Space: the ISS's real current position (open-notify.org,
 *    proxied/cached by the backend) plotted as a live marker, plus NASA's
 *    own public livestream embed.
 *  - Live Alerts: real headlines from a handful of official, first-party
 *    broadcaster/wire RSS feeds (BBC, Al Jazeera, NYT, UN News), parsed
 *    server-side since none of them set CORS headers for a browser fetch.
 *  - NOT built here (same reconnaissance boundary as above): "Recon
 *    Toolkit" (port/MAC/IP scanning, self-track) and "Marauder" (Bluetooth
 *    device sweeps).
 */

/** Flies the flat map to a requested place once per request. */
function FlyToFocus({ focus }: { focus: { lat: number; lng: number; zoom: number; seq: number } }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([focus.lat, focus.lng], focus.zoom, { duration: 1.2 });
  }, [map, focus.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Keeps the flat map centred on a moving point. */
function FollowPoint({ at }: { at: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.panTo(at, { animate: true });
  }, [map, at[0], at[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Map points for humanitarian or political events; bigger for higher severity, labelled with their sourcing. */
function situationPoints(events: SituationEvent[], layerKey: string, color: string): GlobePoint[] {
  return events.map((e) => ({
    id: `sit:${e.id}`,
    layerKey,
    lat: e.lat,
    lng: e.lon,
    color,
    size: e.severity === 3 ? 0.26 : e.severity === 2 ? 0.18 : 0.12,
    title: `S${e.severity} · ${e.typeLabel}: ${e.place ? `${e.place}, ` : ""}${e.countryName}`,
    subtitle: `${e.summary} (${e.confidence === "confirmed" ? `${e.outlets} outlets` : "single source"}${e.precision === "country" ? "; placed at the country's centre" : ""})`,
    time: e.lastDate,
    url: e.sources[0]?.url ?? null,
  }));
}

interface GlobePoint {
  id: string;
  layerKey: string;
  lat: number;
  lng: number;
  color: string;
  size: number;
  title: string;
  subtitle: string;
  time: string | null;
  url: string | null;
  actor?: string;
  details?: string;
  /** Conflict Escalation only — see Map3D.tsx's own field of the same name.
   *  Undefined on every other layer. */
  escalationLevel?: "watch" | "elevated" | "critical";
  /** Aircraft only: heading in degrees from north, to turn the plane symbol. */
  heading?: number;
  /** Conflict Escalation only — used to fetch the full evidence/source-link
   *  list for this country on click. Undefined on every other layer. */
  countryCode?: string;
  /** Conflict Escalation only — how many source links the evidence
   *  endpoint has for this country's current window. Undefined elsewhere. */
  evidenceCount?: number;
  /** Conflict Escalation only — the full incident record (criteria,
   *  indicators with quotes, sources), shown in the detail panel. */
  incident?: EscalationIncident;
}

type LayerGroup = "Natural Hazards" | "Threats & Intel" | "Network Intel" | "Aviation" | "Maritime" | "Space Tracking" | "My Data" | "Media";

/** Icon + accent for a group's own rail button — every group renders
 *  through the same flyout treatment now (see LayerPanel/GroupRailButton),
 *  including a group with only one real layer, confirmed directly against
 *  The reference platform's own real Maritime flyout. */
const GROUP_META: Record<LayerGroup, { icon: LucideIcon; color: string }> = {
  // CloudLightning matches a direct screenshot of the reference platform's own rail icon
  // for this group (a cloud-with-lightning glyph, not a generic pulse icon).
  "Natural Hazards": { icon: CloudLightning, color: HUD.alertOrange },
  // Real label ("Threats & Intel", not "Threats & Infra") confirmed
  // directly from a screenshot of the reference platform's own flyout header.
  "Threats & Intel": { icon: AlertTriangle, color: HUD.alertRed },
  // Network icon matches a direct screenshot of the reference platform's own rail icon for
  // this group (a 3-node hierarchy/network glyph, distinct from Threats &
  // Intel's triangle).
  "Network Intel": { icon: Network, color: "#ff4fa3" },
  Aviation: { icon: Plane, color: HUD.cyan },
  Maritime: { icon: Ship, color: "#00BCD4" },
  "Space Tracking": { icon: Satellite, color: "#9d7bff" },
  "My Data": { icon: Bell, color: HUD.gold },
  // Live broadcasts + merged OSINT alerts — both are "what's being reported
  // right now", distinct from the raw structured event feeds in Threats &
  // Intel above.
  Media: { icon: Tv, color: "#4fd1ff" },
};

interface LayerDef {
  key: string;
  label: string;
  group: LayerGroup;
  color: string;
  icon: LucideIcon;
  fetcher: () => Promise<GlobePoint[]>;
}

function fromGateway(color: string, label: string, predicate?: (f: LiveLayerFeature) => boolean) {
  return (collection: LiveLayerCollection): GlobePoint[] =>
    collection.features
      .filter((f) => (predicate ? predicate(f) : true))
      .map((f: LiveLayerFeature) => ({
        id: f.properties.id,
        layerKey: label,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        color,
        // The reference platform's own points render as tiny flat 2D circles (roughly 3-9px,
        // via MapLibre) — three-globe's pointsData markers are real 3D
        // discs, which read as chunky next to that at any size much above
        // this. Kept small and in a narrow range on purpose to match that
        // crisp, minimal feel rather than the bigger default scale.
        size: 0.1 + f.properties.intensity * 0.16,
        ...(typeof f.properties.heading === "number" ? { heading: f.properties.heading } : {}),
        title: f.properties.title,
        subtitle: `${f.properties.intensityLabel}${f.properties.detail ? ` — ${f.properties.detail}` : ""}`,
        time: f.properties.time,
        url: f.properties.url,
      }));
}

/** What the satellite layer shows: one fire day, or every fire from the range start up to a day. Read by its poll, and set by the timeline. */
type FireView = { mode: "day"; date: string } | { mode: "range"; from: string; to: string };
const fireViewRef: { current: FireView | null } = { current: null };
/** Receives each view's raw collection, so the flat map can draw heat and framed popups from it. */
const fireSinkRef: { current: ((c: LiveLayerCollection, cells: boolean) => void) | null } = { current: null };
/** Loads one fire view from the stored history. Range views come back as ~5 km cells. */
async function fetchFireView(view: FireView): Promise<{ collection: LiveLayerCollection; cells: boolean }> {
  if (view.mode === "day") return { collection: await api.getFireHistoryDay(view.date), cells: false };
  return { collection: await api.getFireHistoryRange(view.from, view.to), cells: true };
}

const LAYER_DEFS: LayerDef[] = [
  { key: "earthquakes", label: "Earthquakes", group: "Natural Hazards", color: "#ff5d5d", icon: Activity, fetcher: async () => fromGateway("#ff5d5d", "Earthquakes")(await api.getLiveEarthquakes()) },
  // Both real rows below share NASA EONET's own event feed, split by the
  // category EONET itself already assigns each event (see the backend's
  // classifyNaturalEvent()) — matching the reference platform's real "NATURAL HAZARDS"
  // flyout (EARTHQUAKES / ACTIVE FIRES / SEVERE WEATHER), confirmed
  // directly from a screenshot of its actual flyout rather than assumed.
  {
    key: "active-fires",
    label: "Wildfires (NASA EONET)",
    group: "Natural Hazards",
    color: "#ffb020",
    icon: Flame,
    fetcher: async () => fromGateway("#ffb020", "Wildfires (NASA EONET)", (f) => f.properties.naturalHazardCategory === "wildfire")(await api.getLiveNaturalEvents()),
  },
  // Rain radar and infrared clouds (RainViewer), drawn as map imagery on the flat map; see WeatherTiles.
  { key: "rain-radar", label: "Rain Radar", group: "Natural Hazards", color: "#60a5fa", icon: CloudRain, fetcher: async () => [] },
  { key: "live-clouds", label: "Live Clouds (Infrared)", group: "Natural Hazards", color: "#cbd5e1", icon: Cloud, fetcher: async () => [] },
  {
    key: "severe-weather",
    label: "Severe Weather",
    group: "Natural Hazards",
    color: "#4fd1ff",
    icon: CloudLightning,
    fetcher: async () => fromGateway("#4fd1ff", "Severe Weather", (f) => f.properties.naturalHazardCategory === "severe-weather")(await api.getLiveNaturalEvents()),
  },
  // Four real rows below match the reference platform's own "THREATS & INTEL" flyout
  // (confirmed directly from a screenshot: NUCLEAR FACILITIES / GLOBAL
  // INCIDENTS / LIVE ALERT PINS / GDELT EVENTS), each backed by genuinely
  // real, sourced data rather than a guess at what the reference platform's own numbers
  // mean:
  {
    key: "nuclear-facilities",
    label: "Nuclear Facilities",
    group: "Threats & Intel",
    color: "#7CFC00",
    icon: Radiation,
    fetcher: async () => fromGateway("#7CFC00", "Nuclear Facilities")(await api.getLiveNuclearFacilities()),
  },
  // ACLED (the obvious real source for a broad "global incidents" feed)
  // is deliberately not used here — its EULA bars a commercial entity
  // from using it in the entity's own dashboard without a paid corporate
  // license (checked directly against acleddata.com/eula), which is
  // exactly this app's situation. This is a second, differently-scoped
  // GDELT query instead — see the backend's /global-incidents route
  // comment for the exact query — still real, still keyless, no
  // licensing conflict.
  // Not live data: a curated list of long-running flashpoints (see standingHotspots.ts), so the map shows where to
  // look on a quiet day. Live, verified escalations are the alert layers; nothing here is an alert.
  {
    key: "standing-hotspots",
    label: "Standing Hotspots",
    group: "Threats & Intel",
    color: "#c084fc",
    icon: Flag,
    fetcher: async () =>
      STANDING_HOTSPOTS.map((h) => ({
        id: `hotspot-${h.id}`,
        layerKey: "Standing Hotspots",
        lat: h.lat,
        lng: h.lon,
        color: "#c084fc",
        size: 0.26,
        title: h.name,
        subtitle: `Standing hotspot (reference, not a live alert) — ${h.note}`,
        time: null,
        url: null,
      })),
  },
  {
    key: "global-incidents",
    label: "Threats & Tensions (GDELT)",
    group: "Threats & Intel",
    color: "#ff9d4f",
    icon: Siren,
    fetcher: async () => fromGateway("#ff9d4f", "Threats & Tensions (GDELT)")(await api.getLiveGlobalIncidents()),
  },
  {
    key: "live-alert-pins",
    label: "Live Alert Pins",
    group: "Threats & Intel",
    color: "#ffd23f",
    icon: Bell,
    fetcher: async () => {
      // Same real per-query alert data "My Alerts" always used (see
      // below) — regrouped and relabeled here to match the reference platform's real
      // "Live Alert Pins" row living under Threats & Intel rather than a
      // separate "My Data" group. Also pulls in the unscoped (query_id
      // NULL) escalation-incident alerts from escalationIncidents.ts — a
      // standing Africa-wide watch that isn't tied to any saved query, so
      // it wouldn't otherwise show up here at all.
      const queries = await api.getQueries();
      const perQuery = await Promise.allSettled([
        ...queries.map((q) => api.getAlerts({ query_id: q.id, status: "open" })),
        api.getAlerts({ unscoped: "1", status: "open" }),
      ]);
      const rows = perQuery.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      const out: GlobePoint[] = [];
      for (const r of rows) {
        if (r.geo_lat == null || r.geo_lng == null) continue;
        out.push({
          id: r.id,
          layerKey: "Live Alert Pins",
          lat: r.geo_lat,
          lng: r.geo_lng,
          color: "#ffd23f",
          size: 0.18,
          title: r.title,
          subtitle: r.geo_label ?? r.level,
          time: r.created_at,
          url: null,
        });
      }
      return out;
    },
  },
  { key: "conflict-events", label: "Fighting & Attacks (GDELT)", group: "Threats & Intel", color: "#7c9cff", icon: AlertTriangle, fetcher: async () => fromGateway("#7c9cff", "Fighting & Attacks (GDELT)")(await api.getLiveConflictEvents()) },
  // Active conflict: countries with organised violence recorded by UCDP in the last 90 days, graded by killed.
  // Drawn from the active-conflict data (see the active-conflicts effect), so this adds no points of its own.
  {
    key: "active-conflicts",
    label: "Active Conflicts (UCDP)",
    group: "Threats & Intel",
    color: "#7e62d0",
    icon: AlertTriangle,
    fetcher: async () => [],
  },
  // Flagged escalation incidents (backend: escalationIncidents.ts) — one
  // marker per incident, placed where the reporting says the event happened.
  // Each one is the product of reports coded against the written codebook
  // — articles read in full, or, until that happens, headlines matched by
  // fixed rules (the panel then says "preliminary"); it shows the criteria met, the
  // indicators with their supporting quotes, the sources, and how precisely
  // the incident is located.
  {
    key: "conflict-escalation",
    label: "Conflict Escalation",
    group: "Threats & Intel",
    color: "#ff9d4f",
    icon: AlertTriangle,
    // Built directly rather than through fromGateway() — this is the one
    // layer that needs a per-point field (escalationLevel) fromGateway's
    // fixed output shape doesn't carry, since it drives the warning-icon
    // treatment and severity coloring in Map3D.tsx.
    fetcher: async () => {
      const collection = await api.getConflictEscalation();
      return collection.features.map((f) => {
        const level = f.properties.escalationLevel ?? "elevated";
        return {
          id: f.properties.id,
          layerKey: "Conflict Escalation",
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
          color: level === "critical" ? "#ff5d5d" : level === "watch" ? "#c9a227" : "#ff9d4f",
          // Bigger and pinned to a fixed size per level (not intensity-
          // scaled like the point layers) — this is meant to read as a
          // deliberate warning marker, not just another dot in the swarm.
          size: level === "critical" ? 0.4 : level === "watch" ? 0.24 : 0.3,
          title: f.properties.title,
          subtitle: f.properties.detail,
          time: f.properties.time,
          url: f.properties.url,
          escalationLevel: level,
          countryCode: f.properties.countryCode,
          evidenceCount: f.properties.evidenceCount,
          incident: f.properties.incident,
        };
      });
    },
  },
  // Deliberately separate from GDELT Events above — GDELT is a real-time,
  // unverified news-mention feed; this is UCDP's own academically-coded
  // Georeferenced Event Dataset (CC BY 4.0, verified commercial-safe), with
  // a real best-estimate death toll per event. Needs UCDP_API_TOKEN set
  // server-side (see bindings.ts) — until then this layer just comes back
  // empty rather than erroring the whole poll loop.
  {
    key: "ucdp-conflict-events",
    label: "Conflict Events (UCDP)",
    group: "Threats & Intel",
    color: "#ff6b6b",
    icon: Siren,
    fetcher: async () => fromGateway("#ff6b6b", "Conflict Events (UCDP)")(await api.getLiveUcdpConflictEvents()),
  },
  // Satellite fire detections from NASA FIRMS (VIIRS), last 24 hours over the Horn of Africa and Sudan. Unlike the
  // EONET wildfire list above, these are individual satellite detections, updated every few hours.
  {
    key: "firms-fires",
    label: "Fire Detections (NASA FIRMS)",
    group: "Natural Hazards",
    color: "#ff7a1a",
    icon: Flame,
    fetcher: async () => {
      const view = fireViewRef.current;
      if (!view) return [];
      const { collection, cells } = await fetchFireView(view);
      fireSinkRef.current?.(collection, cells);
      return fromGateway("#ff7a1a", "Fire Detections (NASA FIRMS)")(collection);
    },
  },
  // The reference platform's own real "NETWORK INTEL" group (confirmed from a screenshot:
  // a dedicated rail icon, separate from Threats & Intel, with rows LIVE
  // MALWARE and BOTNET C2 SERVERS) — Botnet C2 Servers moves here from
  // Threats & Intel to match.
  {
    key: "malware-infrastructure",
    label: "Botnet C2 Servers",
    group: "Network Intel",
    color: "#ff4fa3",
    icon: Shield,
    fetcher: async () => fromGateway("#ff4fa3", "Botnet C2 Infrastructure")(await api.getLiveMalwareInfrastructure()),
  },
  // "Live Malware" — real ThreatFox IOC data, geolocated via a
  // periodically-refreshed GeoLite2 country lookup. Both pieces need a
  // registered credential (abuse.ch Auth-Key, MaxMind license key) that
  // can't be fabricated — this fetcher is wired in once those are set as
  // Worker secrets and the backend route exists; see the backend's
  // liveLayers.ts for the current status of that route.
  {
    key: "live-malware",
    label: "Live Malware",
    group: "Network Intel",
    color: "#ff3d3d",
    icon: Bug,
    fetcher: async () => fromGateway("#ff3d3d", "Live Malware")(await api.getLiveMalware()),
  },
  // Three real, sourced categories rather than the reference platform's full four — see
  // classifyAviation() on the backend (liveLayers.ts) for exactly what
  // each one can and can't actually tell apart, and why "Private Jets"
  // specifically isn't split out from general aviation (it would need a
  // per-aircraft type lookup, infeasible at this data volume on an
  // anonymous, rate-limited OpenSky quota). All three share the same
  // underlying OpenSky fetch — the backend's own cache (15 min TTL, one
  // shared entry for every viewer) means three client-side calls to the
  // same endpoint don't cost three times the upstream credit budget.
  {
    key: "air-traffic-commercial",
    label: "Commercial Airliners",
    group: "Aviation",
    color: "#2fe0c8",
    icon: Plane,
    fetcher: async () => fromGateway("#2fe0c8", "Commercial Flights", (f) => f.properties.aviationClass === "commercial")(await api.getLiveAirTraffic()),
  },
  {
    key: "air-traffic-private",
    label: "General Aviation",
    group: "Aviation",
    color: "#00E676",
    icon: Plane,
    fetcher: async () => fromGateway("#00E676", "Private Aircraft", (f) => f.properties.aviationClass === "private")(await api.getLiveAirTraffic()),
  },
  {
    key: "air-traffic-jets",
    label: "Business Jets",
    group: "Aviation",
    color: "#FF9F1C",
    icon: Plane,
    fetcher: async () => fromGateway("#FF9F1C", "Private Jets", (f) => f.properties.aviationClass === "jet")(await api.getLiveAirTraffic()),
  },
  {
    key: "air-traffic-military",
    label: "Military Aircraft",
    group: "Aviation",
    color: "#FF3D3D",
    icon: Shield,
    fetcher: async () => fromGateway("#FF3D3D", "Military Aircraft", (f) => f.properties.aviationClass === "military")(await api.getLiveAirTraffic()),
  },
  {
    key: "maritime",
    // The reference platform's own real label for this layer (a screenshot of its
    // MARITIME group flyout shows "MARITIME / NAVAL" as the one row) —
    // this app's data is still the same real static reference set (major
    // ports, naval bases, shipping chokepoints), just named to match.
    label: "Maritime / Naval",
    group: "Maritime",
    color: "#3fd0ff",
    icon: Anchor,
    fetcher: async () => fromGateway("#3fd0ff", "Maritime")(await api.getLiveMaritime()),
  },
  {
    key: "cable-landing-points",
    // The point half of the submarine-cables layer — the line half
    // (colored cable routes) is a separate rail toggle above the groups,
    // matching how "Maritime Lines" works alongside this same group. See
    // api.getSubmarineCables's comment for the OSM-vs-TeleGeography
    // sourcing note.
    label: "Cable Landing Points",
    group: "Maritime",
    color: "#e0e0e0",
    icon: Cable,
    fetcher: async () => fromGateway("#e0e0e0", "Cable Landing Points")((await api.getSubmarineCables()).landingPoints),
  },
  {
    key: "ais-vessels",
    // Real live vessel positions from AISstream.io's global AIS feed (see
    // AISSTREAM_API_KEY's comment in bindings.ts) — distinct from the static
    // "Maritime / Naval" reference layer above (ports/bases/chokepoints).
    label: "Live Vessels (AIS)",
    group: "Maritime",
    color: "#ffb443",
    icon: Waypoints,
    fetcher: async () => fromGateway("#ffb443", "Live Vessels")(await api.getLiveAisVessels()),
  },
  // Real satellite positions computed from CelesTrak's own orbital elements
  // (SGP4 propagation on the backend — see satelliteCategory on
  // liveLayers.ts's /satellites route for exactly which real CelesTrak
  // group(s) back each category below). "All Satellites" is every
  // satellite the shared fetch returns, not a separate larger catalog —
  // propagating CelesTrak's full active-satellite catalog on every refresh
  // was judged too expensive for this Worker's CPU budget and too dense to
  // read on the globe (see the backend comment for the full reasoning), so
  // this is real, sourced data at an honestly bounded scope rather than a
  // claim to track every catalogued object in orbit. All six share one
  // upstream fetch via the backend's own 2-min shared cache.
  {
    key: "satellites-all",
    label: "All Satellites",
    group: "Space Tracking",
    color: "#9d7bff",
    icon: Satellite,
    fetcher: async () => fromGateway("#9d7bff", "Satellites")(await api.getLiveSatellites()),
  },
  {
    key: "satellites-starlink-comms",
    label: "Starlink / Comms",
    group: "Space Tracking",
    color: "#4fd1ff",
    icon: Radio,
    fetcher: async () => fromGateway("#4fd1ff", "Starlink / Comms", (f) => f.properties.satelliteCategory === "starlink-comms")(await api.getLiveSatellites()),
  },
  {
    key: "satellites-military-intel",
    label: "Military / Intel",
    group: "Space Tracking",
    color: "#FF3D3D",
    icon: Shield,
    fetcher: async () => fromGateway("#FF3D3D", "Military / Intel", (f) => f.properties.satelliteCategory === "military-intel")(await api.getLiveSatellites()),
  },
  {
    key: "satellites-gps-nav",
    label: "GPS / Navigation",
    group: "Space Tracking",
    color: "#00E676",
    icon: Navigation,
    fetcher: async () => fromGateway("#00E676", "GPS / Navigation", (f) => f.properties.satelliteCategory === "gps-nav")(await api.getLiveSatellites()),
  },
  {
    key: "satellites-earth-observation",
    label: "Earth Observation",
    group: "Space Tracking",
    color: "#ffb020",
    icon: Activity,
    fetcher: async () => fromGateway("#ffb020", "Earth Observation", (f) => f.properties.satelliteCategory === "earth-observation")(await api.getLiveSatellites()),
  },
  {
    key: "satellites-stations-telescopes",
    label: "Stations / Telescopes",
    group: "Space Tracking",
    color: "#ffd23f",
    icon: Telescope,
    fetcher: async () => fromGateway("#ffd23f", "Stations / Telescopes", (f) => f.properties.satelliteCategory === "stations-telescopes")(await api.getLiveSatellites()),
  },
  // Humanitarian and political events: what the incident pipeline reads but does not count as armed conflict
  // (displacement, outbreaks, hunger, disasters, unrest, elections, changes of government). Graded S1 to S3.
  {
    key: "humanitarian-events",
    label: "Humanitarian Events",
    group: "Threats & Intel",
    color: "#38bdf8",
    icon: HeartPulse,
    fetcher: async () => situationPoints((await api.getSituationEvents()).events.filter((e) => e.category === "humanitarian"), "Humanitarian Events", "#38bdf8"),
  },
  {
    key: "political-events",
    label: "Political Events",
    group: "Threats & Intel",
    color: "#e879f9",
    icon: Landmark,
    fetcher: async () => situationPoints((await api.getSituationEvents()).events.filter((e) => e.category === "political"), "Political Events", "#e879f9"),
  },
  // Internet outages Cloudflare has confirmed (shutdowns, power and cable cuts), and where network attacks come from.
  // Both need a Cloudflare API token on the server (CLOUDFLARE_RADAR_TOKEN); without one the layer says so.
  {
    key: "cf-outages",
    label: "Internet Outages",
    group: "Network Intel",
    color: "#F38020",
    icon: WifiOff,
    fetcher: async () => {
      const r = await api.getCloudflareRadar();
      if (!r.configured) throw new Error(r.errors[0] ?? "Cloudflare Radar is not set up");
      return r.outages.map((o): GlobePoint => ({
        id: `cfo:${o.id}`,
        layerKey: "Internet Outages",
        lat: o.lat,
        lng: o.lon,
        color: o.ongoing ? "#FF3D3D" : "#F38020",
        size: o.ongoing ? 0.26 : 0.16,
        title: `${o.ongoing ? "Ongoing" : "Ended"} internet outage: ${o.countryName}`,
        subtitle: `${[o.scope, o.cause.replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · ")}${o.description ? `. ${o.description}` : ""}. From ${o.start.slice(0, 10)}${o.end ? ` to ${o.end.slice(0, 10)}` : ""}. Source: Cloudflare Radar.`,
        time: o.start || null,
        url: o.url || null,
      }));
    },
  },
  {
    key: "cf-attacks",
    label: "Attack Origins",
    group: "Network Intel",
    color: "#E11D48",
    icon: Crosshair,
    fetcher: async () => {
      const r = await api.getCloudflareRadar();
      if (!r.configured) throw new Error(r.errors[0] ?? "Cloudflare Radar is not set up");
      return r.attackOrigins.map((a): GlobePoint => ({
        id: `cfa:${a.country}`,
        layerKey: "Attack Origins",
        lat: a.lat,
        lng: a.lon,
        color: "#E11D48",
        size: Math.min(0.4, 0.1 + a.share / 40),
        title: `${a.countryName}: ${a.share}% of network attacks`,
        subtitle: "Share of network-layer (DDoS) attack traffic Cloudflare saw coming from this country over the last 7 days. Source: Cloudflare Radar.",
        time: r.fetchedAt,
        url: "https://radar.cloudflare.com/security",
      }));
    },
  },
  // Watch zones: standing warning markers over Africa and Middle East theatres (an Afrilens editorial rating, as
  // The reference platform keeps its conflict zones), each listing the reports and escalation incidents that fall in it.
  {
    key: "watch-zones",
    label: "Watch Zones",
    group: "Threats & Intel",
    color: "#FF9500",
    icon: AlertTriangle,
    fetcher: async () => {
      const { zones } = await api.getWatchZones();
      const colour = { war: "#FF3D3D", high: "#FF9500", elevated: "#FFD23F" } as const;
      const label = { war: "Active war", high: "High tension", elevated: "Elevated" } as const;
      return zones.map((z): GlobePoint => ({
        id: `zone:${z.id}`,
        layerKey: "Watch Zones",
        lat: z.lat,
        lng: z.lng,
        color: colour[z.severity],
        size: z.severity === "war" ? 0.34 : z.severity === "high" ? 0.28 : 0.22,
        title: `⚠ ${z.label} · ${label[z.severity]}`,
        subtitle: `${z.description} ${z.headlineCount} recent report(s), ${z.incidents.length} escalation incident(s) in the zone.${z.headlines[0] ? ` Latest: ${z.headlines[0].title} (${z.headlines[0].source}).` : ""} Severity is an Afrilens editorial rating, not a live measurement.`,
        time: null,
        url: z.headlines[0]?.url ?? null,
      }));
    },
  },
  // Squares where aircraft report poor satellite-navigation accuracy: a sign of GPS jamming or spoofing.
  {
    key: "gps-interference",
    label: "GPS Interference",
    group: "Threats & Intel",
    color: "#f97316",
    icon: Satellite,
    fetcher: async () => {
      const data = await api.getGpsInterference();
      return data.cells
        .filter((c) => c.level !== "low")
        .map((c): GlobePoint => ({
          id: `gps:${c.lat}:${c.lon}`,
          layerKey: "GPS Interference",
          lat: c.lat,
          lng: c.lon,
          color: c.level === "high" ? "#ef4444" : "#f59e0b",
          size: c.level === "high" ? 0.26 : 0.16,
          title: `${c.level === "high" ? "High" : "Medium"} GPS interference: ${Math.round(c.share * 100)}% of aircraft`,
          subtitle: `${c.poor} of ${c.aircraft} aircraft in this 55 km square reported poor position accuracy since ${data.since}. A sign of jamming or spoofing, not proof. ${data.attribution}.`,
          time: data.fetchedAt,
          url: null,
        }));
    },
  },
  // Telegram posts that name a place the Lens can put on the map. The point sits at that country's or region's
  // centre, not at the event: the incident pipeline is what locates events properly, and Telegram posts feed it too.
  {
    key: "telegram-posts",
    label: "Telegram Posts",
    group: "Threats & Intel",
    color: "#2aabee",
    icon: Send,
    fetcher: async () => {
      const feed = await api.getOsintAlerts();
      return feed.alerts
        .filter((a) => a.coords && a.source.startsWith("t.me/"))
        .map((a): GlobePoint => ({
          id: `tg:${a.id}`,
          layerKey: "Telegram Posts",
          lat: a.coords![0],
          lng: a.coords![1],
          color: "#2aabee",
          size: a.flag === "BREAKING" ? 0.2 : 0.12,
          title: `${a.flag === "BREAKING" ? "BREAKING: " : ""}${a.title}`,
          subtitle: `${a.source_name}${a.lean ? ` (${a.lean})` : ""} · unverified Telegram post, placed at ${a.coords_anchor ?? "the country"}'s centre, not at the event${a.also_reported_by.length ? ` · also on ${a.also_reported_by.length} other channel(s)` : ""}`,
          time: a.published,
          url: a.link,
        }));
    },
  },
  // "News Reports" and "Live Broadcasts" — Media group. Both adapted from
  // The reference platform MIT license); see the backend
  // routes (osint-alerts, live-broadcasts) for the full source roster and
  // what's deliberately different from the reference platform's own version.
  {
    key: "osint-alerts",
    label: "News Reports",
    group: "Media",
    color: "#ff9d4f",
    icon: Radio,
    // Not fromGateway() — this feed's own shape (bloc/lean labels, risk
    // score, cross-posting) doesn't fit NormalizedFeature, and every point
    // needs its own popup fields (bloc-colored, not layer-colored).
    fetcher: async () => {
      const feed = await api.getOsintAlerts();
      // Telegram posts are the Telegram Posts layer's, so they are not pinned twice.
      return feed.alerts
        .filter((a) => a.coords && !a.source.startsWith("t.me/"))
        .map((a): GlobePoint => {
          const blocColor: Record<string, string> = { western: "#4fd1ff", russian: "#ff5d5d", regional: "#ffd23f", independent: "#00E676" };
          return {
            id: a.id,
            layerKey: "News Reports",
            lat: a.coords![0],
            lng: a.coords![1],
            color: (a.bloc && blocColor[a.bloc]) || "#ff9d4f",
            size: a.flag === "BREAKING" ? 0.22 : 0.14,
            title: `${a.flag === "BREAKING" ? "⚠ BREAKING — " : ""}${a.title}`,
            subtitle: `${a.source_name}${a.lean ? ` (${a.lean})` : ""}${a.coords_default ? " — country-anchor, not precise" : ""}${a.also_reported_by.length ? ` · also carried by ${a.also_reported_by.length} other source(s)` : ""}`,
            time: a.published,
            url: a.link,
          };
        });
    },
  },
  {
    key: "live-broadcasts",
    label: "Live Broadcasts",
    group: "Media",
    color: "#7c9cff",
    icon: Tv,
    fetcher: async () => {
      const data = await api.getLiveBroadcasts();
      return data.broadcasts.map((b): GlobePoint => ({
        id: `broadcast:${b.id}`,
        layerKey: "Live Broadcasts",
        lat: b.lat,
        lng: b.lng,
        color: "#7c9cff",
        size: 0.14,
        title: b.name,
        subtitle: `${b.city}, ${b.country} — ${b.category}${b.embedAllowed ? "" : " (opens externally)"}`,
        time: null,
        url: b.url,
      }));
    },
  },
  {
    key: "my-incidents",
    label: "My Incidents",
    group: "My Data",
    color: "#ff9de2",
    icon: MapPin,
    fetcher: async () => {
      const rows = await api.getIncidents({ limit: myIncidentsLimit });
      return rows.map(incidentRowToPoint).filter((p): p is GlobePoint => p !== null);
    },
  },
];

/** Shared between the "My Incidents" layer's own poll and the Incidents
 *  tool's live search results, so a filtered search shows exactly the same
 *  marker styling as the unfiltered layer — just a different underlying
 *  row set. */
function incidentRowToPoint(r: IncidentItem): GlobePoint | null {
  if (r.latitude == null || r.longitude == null) return null;
  return {
    id: r.id,
    layerKey: "My Incidents",
    lat: r.latitude,
    lng: r.longitude,
    color: classifyIncident(r).color,
    size: 0.16,
    title: [r.city, r.province].filter(Boolean).join(", ") || r.district || r.precise_location || r.country || "Incident",
    subtitle: [r.sector, r.tactic].filter(Boolean).join(" · "),
    time: r.occurred_date ?? r.occurred_at ?? null,
    url: null,
    actor: r.actor ?? undefined,
    details: r.details ?? undefined,
  };
}

/** Saved AOI's outer ring, in this view's own [lat, lng] tuple order —
 *  map_shapes stores a plain GeoJSON Feature ([lng, lat] coordinates), and
 *  only a single-ring Polygon is rendered here (a shapefile/geojson upload
 *  with holes or a MultiPolygon just won't outline on this view — the
 *  Shapes panel that creates these always writes a plain single-ring
 *  Polygon Feature, so that covers everything drawn from here). */
function shapeRingLatLng(shape: SavedShape): LatLng[] {
  if (shape.geometry.type !== "Feature") return [];
  const geom = shape.geometry.geometry;
  if (!geom || geom.type !== "Polygon") return [];
  return geom.coordinates[0].map(([lng, lat]) => [lat, lng] as LatLng);
}

const GROUP_ORDER: LayerGroup[] = ["Natural Hazards", "Threats & Intel", "Network Intel", "Aviation", "Maritime", "Media", "Space Tracking", "My Data"];

/** Real global shipping-lane geometries now come from the backend's
 *  /api/live-layers/maritime-lines (see LayerState below and
 *  backend/src/data/maritimeLanes.ts) instead of being hand-approximated
 *  here. That data is computed via searoute-js over a real maritime
 *  network graph (Eurostat marnet + Oak Ridge National Labs' Global
 *  Shipping Lane Network), which threads real chokepoints — Suez,
 *  Gibraltar, Panama, Malacca, Bab-el-Mandeb, the Danish Straits — rather
 *  than a straight chord across land, and gives a genuinely dense web of
 *  ~40 real trunk routes (not a handful of hand-picked ones) to match how
 *  dense real shipping-lane visualizations look. The reference platform itself has no
 *  shipping-lane rendering at all (checked directly against its source —
 *  no lane/route code exists there, and its "ship" layer is wired to a
 *  backend field that's never actually populated), so this isn't matching
 *  something the reference platform has; it's a legitimate addition of real trade routes,
 *  tied to the same Maritime toggle. Only drawn in 3D mode — a flat
 *  equirectangular Polyline through these same raw coordinates would
 *  visibly wrap the wrong way around the antimeridian on the Pacific
 *  routes, which is worse than not showing them there at all. */

const POLL_MS = 60_000;
/** Incidents fetched for the map: the latest 2,000 by default (fast), or everything on demand. */
const INCIDENT_DEFAULT_LIMIT = 2000;
const INCIDENT_ALL_LIMIT = 250000;
let myIncidentsLimit = INCIDENT_DEFAULT_LIMIT;

type LayerState = { data: GlobePoint[] | null; loading: boolean; error: string | null };
/** The view: the 3D globe or the flat map. The basemap (liveBasemaps.ts) is chosen separately and works with either. */
type MapMode = "3d" | "2d";

/** Which right-side tool panel is open, if any — at most one at a time, both
 *  because that's simpler state to reason about and because Drawing Tools
 *  and Route both interpret a map/globe click as their own next action, so
 *  two active together would fight over the same click. */
type RightTool = "monitor" | "draw" | "route" | "space" | "news" | "incidents" | "shapes" | "economy" | "markets" | "listen" | "crypto" | "telegram" | "events" | "afrintel" | "analyses" | null;

/** What Live OSINT needs from the app shell to host Live Monitoring: the
 *  user's monitoring queries, and ways to open a query's dashboard or the
 *  query editor (full pages of their own, which return here). */
export interface LiveIntelViewProps {
  queries: MonitoringQueryItem[];
  onQueriesChanged: () => void;
  onOpenQuery: (queryId: string) => void;
  onNewQuery: () => void;
  onEditQuery: (queryId: string) => void;
  /** Tool to show open on arrival — "monitor" when returning from a
   *  monitoring query's dashboard or editor. */
  initialTool?: "monitor" | null;
  /** False when the login's client has not been given AfrIntel (Admin → client → Resources). */
  canAfrIntel?: boolean;
  /** The platform admin may trigger a collection run from the Analyses panel. */
  isAdmin?: boolean;
}

/** One state per monitoring query switched on as a map layer. */
type MonitorLayerState = { result: LocatedMonitoringResult | null; loading: boolean; error: string | null };

/** Fixed colours for monitoring-query layers, assigned by the query's
 *  position in the list so a query keeps its colour between visits. */
const MONITOR_LAYER_COLORS = ["#4dd0ff", "#ffb55c", "#b388ff", "#69f0ae", "#ff8a80", "#ffd740", "#80cbc4", "#f48fb1"];
/** How far back a monitoring layer looks. */
const MONITOR_LAYER_HOURS = 24;
type DrawMode = "distance" | "area" | null;

/** [lat, lng] tuples throughout the drawing/route tools — matches how a
 *  map click naturally arrives (Leaflet's own LatLng, and this view's own
 *  onGlobeClick handler below), converted to GeoJSON's [lng, lat] order
 *  only at the export/API boundary. */
type LatLng = [number, number];

const EARTH_RADIUS_KM = 6371.0088;

function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function pathDistanceKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

/** Standard spherical-polygon-area approximation (the same one behind most
 *  GIS "measure area" tools, sometimes credited to Chamberlain & Duquette /
 *  JPL) — accurate enough for a rough on-map measurement, not surveyed
 *  cadastral precision. Treats the point list as an implicitly closed ring
 *  (last point connects back to the first). */
function sphericalPolygonAreaKm2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];
    total += (lng2 - lng1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

function formatKm(km: number): string {
  return km >= 1 ? `${km.toFixed(km >= 100 ? 0 : 1)} km` : `${Math.round(km * 1000)} m`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

/** Downloads a drawn shape as a standalone .geojson file — client-side only
 *  (Blob + a synthetic anchor click), no server round-trip needed since the
 *  shape only ever existed in this browser session anyway. */
function downloadDrawingAsGeoJson(points: LatLng[], mode: DrawMode) {
  if (!mode || points.length < 2) return;
  const coordinates = points.map(([lat, lng]) => [lng, lat]);
  const isArea = mode === "area" && points.length >= 3;
  const geometry = isArea ? { type: "Polygon" as const, coordinates: [[...coordinates, coordinates[0]]] } : { type: "LineString" as const, coordinates };
  const properties = isArea
    ? { measurement: "area", areaKm2: Number(sphericalPolygonAreaKm2(points).toFixed(3)) }
    : { measurement: "distance", distanceKm: Number(pathDistanceKm(points).toFixed(3)) };
  const fc = { type: "FeatureCollection", features: [{ type: "Feature", geometry, properties }] };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `live-osint-${mode}-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LiveIntelView({ queries, onQueriesChanged, onOpenQuery, onNewQuery, onEditQuery, initialTool = null, canAfrIntel = true, isAdmin = false }: LiveIntelViewProps) {
  // Every layer starts off at login except the escalation icons; the hotspot pulses and waves are on too (see FlatMap).
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    earthquakes: false,
    "active-fires": false,
    "severe-weather": false,
    "conflict-events": false,
    "conflict-escalation": true,
    "active-conflicts": false,
    "nuclear-facilities": false,
    "global-incidents": false,
    "live-alert-pins": false,
    "air-traffic-commercial": false,
    "air-traffic-private": false,
    "air-traffic-jets": false,
    "air-traffic-military": false,
    "malware-infrastructure": false,
    "live-malware": false,
    maritime: false,
    "satellites-all": false,
    "satellites-starlink-comms": false,
    "satellites-military-intel": false,
    "satellites-gps-nav": false,
    "satellites-earth-observation": false,
    "satellites-stations-telescopes": false,
    "my-incidents": false,
    "osint-alerts": false,
    "telegram-posts": false,
    "humanitarian-events": false,
    "political-events": false,
    "gps-interference": false,
    "watch-zones": false,
    "rain-radar": false,
    "live-clouds": false,
    "cf-outages": false,
    "cf-attacks": false,
    "live-broadcasts": false,
    // Decoupled from the "maritime" points layer above (ports/bases/
    // chokepoints) — this toggles the shipping-lane arcs (maritimeLanes,
    // fetched from the backend) instead, matching the reference platform's own real
    // product having a separate
    // "Maritime Lines" toggle alongside its points-based "Maritime / Naval"
    // layer (confirmed directly from a screenshot of its actual left rail,
    // not the open-source mirror, which has no lines concept at all).
    "maritime-lines": false,
    "submarine-cables": false,
    "ais-vessels": false,
    "ucdp-conflict-events": false,
    "firms-fires": false,
  });
  const [mapMode, setMapMode] = useState<MapMode>(() => (readViewParams().at ? "2d" : "3d"));
  // Each view is loaded the first time it is shown, then kept (see the map area below).
  const [globeMounted, setGlobeMounted] = useState(mapMode === "3d");
  const [flatMounted, setFlatMounted] = useState(mapMode !== "3d");
  const [flatMap, setFlatMap] = useState<LeafletMap | null>(null);
  const viewModeRef = useRef(mapMode);
  // The basemap, the same for both views; a shared imagery link opens on satellite. Remembered.
  const [basemap, setBasemapState] = useState<BasemapId>(() => {
    if (readViewParams().at) return "satellite-labels";
    try {
      const saved = localStorage.getItem("lens.basemap") as BasemapId | null;
      return saved && BASEMAP_IDS.includes(saved) ? saved : "dark";
    } catch {
      return "dark";
    }
  });
  const setBasemap = (b: BasemapId) => {
    setBasemapState(b);
    try {
      localStorage.setItem("lens.basemap", b);
    } catch {
      /* storage unavailable */
    }
  };
  // The left layer panel and the right tool rail are hidden until asked for, so the map is clean; the choice is remembered.
  const [leftOpen, setLeftOpen] = useState<boolean>(() => { try { return localStorage.getItem("lens.liveIntel.left") === "1"; } catch { return false; } });
  const [rightOpen, setRightOpen] = useState<boolean>(() => { if (initialTool) return true; try { return localStorage.getItem("lens.liveIntel.right") === "1"; } catch { return false; } });
  const togglePanel = (side: "left" | "right") => {
    const set = side === "left" ? setLeftOpen : setRightOpen;
    set((v) => { try { localStorage.setItem(`lens.liveIntel.${side}`, v ? "0" : "1"); } catch { /* private mode */ } return !v; });
  };
  // The 3D map's clicked-feature detail — docked into a left-side panel
  // (Map3DDetailPanel) instead of a MapLibre Popup floating over the map
  // itself, per Simon's direction. Cleared whenever the mode switches away
  // from 3D so a stale selection doesn't linger invisibly in state.
  const [map3DSelectedFeature, setMap3DSelectedFeature] = useState<Map3DSelectedFeature | null>(null);
  useEffect(() => {
    if (mapMode !== "3d") setMap3DSelectedFeature(null);
  }, [mapMode]);
  const [layers, setLayers] = useState<Record<string, LayerState>>(() =>
    Object.fromEntries(LAYER_DEFS.map((d) => [d.key, { data: null, loading: true, error: null }]))
  );
  const [clock, setClock] = useState(() => new Date());
  // Real computed sea-lane geometries (see the file comment above
  // SHIPPING_LANES's old spot) — reference data like /maritime and
  // /nuclear-facilities, so one fetch on mount is enough, no polling.
  const [maritimeLanes, setMaritimeLanes] = useState<{ points: [number, number][]; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .getLiveMaritimeLines()
      .then((d) => !cancelled && setMaritimeLanes(d.lanes))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Real OpenStreetMap submarine-cable routes (see api.getSubmarineCables's
  // comment for exactly why OSM, not TeleGeography's submarinecablemap.com
  // data) — reference data like the shipping lanes above, one fetch on
  // mount, 24h server-side cache either way.
  const [submarineCables, setSubmarineCables] = useState<{ points: [number, number][]; label: string; color: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .getSubmarineCables()
      .then((d) => !cancelled && setSubmarineCables(d.cables))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // DISPLAY toggles — the reference platform's own left-panel group of the same name (its
  // real source labels them "Day / Night Cycle" and gates buildings/terrain
  // by zoom rather than a manual switch; see LayerPanel/Map3D's own
  // comments for exactly what each does).
  const [showDayNight, setShowDayNight] = useState(false);
  const [showBuildings, setShowBuildings] = useState(false);
  const [showTerrain, setShowTerrain] = useState(false);
  // MapTiler Weather on the globe (GlobeWeather.tsx), and the globe's label language. The language is remembered.
  const [globeWeather, setGlobeWeather] = useState<GlobeWeatherKind | null>(null);
  const [labelLang, setLabelLangState] = useState<string>(() => {
    try {
      return localStorage.getItem("lens.labelLang") ?? "en";
    } catch {
      return "en";
    }
  });
  const setLabelLang = (l: string) => {
    setLabelLangState(l);
    try {
      localStorage.setItem("lens.labelLang", l);
    } catch {
      /* storage unavailable */
    }
  };
  // Map controls that start hidden and are switched on from the Display group: zoom and pan buttons, and the fire timeline.
  const [showNav, setShowNav] = useState(false);
  const [showFirePanel, setShowFirePanel] = useState(false);

  // --- Right-side tools: at most one open at a time (see RightTool). ---
  const [activeTool, setActiveTool] = useState<RightTool>(initialTool);
  // A tool's panel is shown only while the right-hand panel is open.
  const rightTool = rightOpen ? activeTool : null;
  // Anything that opens a tool (an alert, a shortcut) also shows the right-hand panel it lives in.
  useEffect(() => { if (activeTool) setRightOpen(true); }, [activeTool]);

  // --- Live Monitoring: the user's monitoring queries as map layers.
  // Each query switched on here has its recent matches fetched (located
  // from the places their own text names — see the backend's
  // /api/events/located) and drawn on the map, refreshed on the same
  // cadence as every other layer. Which queries are on is remembered per
  // browser (monitorLayers.ts).
  const [activeMonitorIds, setActiveMonitorIds] = useState<Set<string>>(() => loadMonitorLayerIds());
  const [monitorLayers, setMonitorLayers] = useState<Record<string, MonitorLayerState>>({});

  const loadMonitorLayer = useCallback((queryId: string) => {
    setMonitorLayers((prev) => ({ ...prev, [queryId]: { result: prev[queryId]?.result ?? null, loading: true, error: null } }));
    api
      .getLocatedEvents(queryId, MONITOR_LAYER_HOURS)
      .then((result) => setMonitorLayers((prev) => ({ ...prev, [queryId]: { result, loading: false, error: null } })))
      .catch((err) =>
        setMonitorLayers((prev) => ({ ...prev, [queryId]: { result: prev[queryId]?.result ?? null, loading: false, error: err instanceof Error ? err.message : "Unavailable" } }))
      );
  }, []);

  // Only ids that still belong to a query the user has — a deleted query's
  // id can linger in storage. Joined into a string so the polling effect
  // below restarts only when the set of live layers actually changes.
  const liveMonitorIdsKey = useMemo(
    () =>
      queries
        .filter((q) => activeMonitorIds.has(q.id))
        .map((q) => q.id)
        .join(","),
    [queries, activeMonitorIds]
  );
  useEffect(() => {
    const ids = liveMonitorIdsKey ? liveMonitorIdsKey.split(",") : [];
    if (ids.length === 0) return;
    ids.forEach(loadMonitorLayer);
    const interval = setInterval(() => ids.forEach(loadMonitorLayer), POLL_MS);
    return () => clearInterval(interval);
  }, [liveMonitorIdsKey, loadMonitorLayer]);

  function toggleMonitorLayer(queryId: string) {
    setActiveMonitorIds((prev) => {
      const next = new Set(prev);
      if (next.has(queryId)) next.delete(queryId);
      else next.add(queryId);
      saveMonitorLayerIds(next);
      return next;
    });
  }

  // One marker per place per query (not one per article): several reports
  // about the same town would otherwise sit exactly on top of each other
  // with only the last one clickable. The marker says how many matches it
  // stands for and how precisely they are located.
  const monitorLayerPoints = useMemo(() => {
    const out: GlobePoint[] = [];
    queries.forEach((q, qi) => {
      if (!activeMonitorIds.has(q.id)) return;
      const events = monitorLayers[q.id]?.result?.events ?? [];
      const color = MONITOR_LAYER_COLORS[qi % MONITOR_LAYER_COLORS.length];
      const byPlace = new Map<string, typeof events>();
      for (const ev of events) {
        const list = byPlace.get(ev.place) ?? [];
        list.push(ev);
        byPlace.set(ev.place, list);
      }
      for (const [place, group] of byPlace) {
        const newest = group[0]; // the endpoint returns newest first
        const precisionNote =
          newest.precision === "country"
            ? " Country-level: these reports name no specific place."
            : newest.precision === "region"
              ? " Region-level: these reports name no specific town."
              : "";
        const headlines = group
          .slice(0, 3)
          .map((ev) => (ev.title || ev.snippet).slice(0, 110))
          .join(" • ");
        out.push({
          id: `monitor-${q.id}-${place}`,
          layerKey: `Monitoring: ${q.name}`,
          lat: newest.lat,
          lng: newest.lon,
          color,
          size: Math.max(0.16, Math.min(0.34, 0.14 + group.length / 40)),
          title: `${place} — ${group.length} match${group.length === 1 ? "" : "es"}`,
          subtitle: `${headlines}${group.length > 3 ? ` • +${group.length - 3} more` : ""}.${precisionNote}`,
          time: newest.published_at,
          url: newest.url,
        });
      }
    });
    return out;
  }, [queries, activeMonitorIds, monitorLayers]);

  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([]);

  const [routeMode, setRouteMode] = useState<RouteProfile>("driving");
  const [routeOrigin, setRouteOrigin] = useState<LatLng | null>(null);
  const [routeDestination, setRouteDestination] = useState<LatLng | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [issPos, setIssPos] = useState<IssPosition | null>(null);
  const [issError, setIssError] = useState<string | null>(null);

  // Where the map should fly to, from a Locate button in Live Alerts; seq makes a repeat request count.
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number; seq: number } | null>(null);
  // AfrIntel: items AfrIntel Assist marked (cyan), and the forecast run on screen, whose actors and relations are drawn.
  const [afrIntelMarks, setAfrIntelMarks] = useState<{ lat: number; lng: number; title: string; url: string | null }[]>([]);
  const [afrIntelRun, setAfrIntelRun] = useState<AfrIntelRun | null>(null);
  const afrIntelLayerCatalog = useMemo(() => LAYER_DEFS.map((d) => ({ key: d.key, label: d.label, group: d.group as string })), []);

  // --- Economy tool: World Bank indicators (GDP, growth, inflation, trade)
  // across Afrilens's African coverage set — fetched lazily on first open,
  // since these barely change and there's no reason to poll them. ---
  const [econData, setEconData] = useState<EconomicIndicators | null>(null);
  const [econLoading, setEconLoading] = useState(false);
  const [econError, setEconError] = useState<string | null>(null);
  useEffect(() => {
    if (activeTool !== "economy" || econData || econLoading) return;
    setEconLoading(true);
    api
      .getEconomicIndicators()
      .then((d) => {
        setEconData(d);
        setEconError(null);
      })
      .catch((err) => setEconError(err instanceof Error ? err.message : "World Bank feed unavailable"))
      .finally(() => setEconLoading(false));
  }, [activeTool, econData, econLoading]);

  // --- Social Listening tool: keyword-driven, not auto-polled — a search
  // box, not a fixed feed, since there's no single "right" keyword to
  // watch by default. See socialListening.ts for the source breakdown
  // (GDELT tone/volume + optional Mastodon posts). ---
  const [listenQuery, setListenQuery] = useState("");
  const [listenResult, setListenResult] = useState<SocialListeningResult | null>(null);
  const [listenLoading, setListenLoading] = useState(false);
  const [listenError, setListenError] = useState<string | null>(null);
  function runSocialListening(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setListenLoading(true);
    setListenError(null);
    api
      .getSocialListening(trimmed)
      .then((r) => {
        setListenResult(r);
        setListenError(null);
      })
      .catch((err) => setListenError(err instanceof Error ? err.message : "Social listening feed unavailable"))
      .finally(() => setListenLoading(false));
  }

  // --- Saved/named listening queries ("dashboard for listening") — persisted
  // via listening_queries, loaded once and refreshed after any create/
  // update/delete. A "pinned" query also shows as a toggle on the left rail
  // (see LayerPanel's Social Listening flyout below); toggling one of those
  // on adds it to activeListeningIds, which the polling effect below keeps
  // live-refreshed the same way LAYER_DEFS polls every other layer. ---
  const [listenTab, setListenTab] = useState<"search" | "dashboard">("search");
  const [savedListeningQueries, setSavedListeningQueries] = useState<SavedListeningQuery[]>([]);
  const [listenSaveName, setListenSaveName] = useState("");
  const [listenSaving, setListenSaving] = useState(false);
  const [activeListeningIds, setActiveListeningIds] = useState<Set<string>>(new Set());
  const [listeningLiveData, setListeningLiveData] = useState<Record<string, SocialListeningResult | null>>({});
  const [listeningLiveErrors, setListeningLiveErrors] = useState<Record<string, string | null>>({});
  const [listeningLiveLoading, setListeningLiveLoading] = useState<Record<string, boolean>>({});

  function refreshListeningQueries() {
    api.getListeningQueries().then(setSavedListeningQueries).catch(() => {});
  }
  useEffect(() => {
    refreshListeningQueries();
  }, []);

  // Manual, not auto-polled: this used to re-fetch every pinned query every
  // 60s on its own, which — stacked on top of GDELT Events, Global
  // Incidents, and Activity Index all independently hitting the same free,
  // shared-rate-limited GDELT API — was directly contributing to the 429s.
  // Toggling a query on in the left rail now just marks it "on" (so it
  // stays plotted on the map with whatever data it last fetched); getting
  // fresh data is an explicit click, here or from the Dashboard tab, so the
  // person controls exactly when another GDELT request goes out instead of
  // it happening on a timer they don't see.
  function pollListeningQuery(sq: SavedListeningQuery) {
    setListeningLiveLoading((prev) => ({ ...prev, [sq.id]: true }));
    api
      .getSocialListening(sq.query)
      .then((r) => {
        setListeningLiveData((prev) => ({ ...prev, [sq.id]: r }));
        setListeningLiveErrors((prev) => ({ ...prev, [sq.id]: null }));
      })
      .catch((err) => setListeningLiveErrors((prev) => ({ ...prev, [sq.id]: err instanceof Error ? err.message : "Unavailable" })))
      .finally(() => setListeningLiveLoading((prev) => ({ ...prev, [sq.id]: false })));
  }
  function refreshListeningById(id: string) {
    const sq = savedListeningQueries.find((q) => q.id === id);
    if (sq) pollListeningQuery(sq);
  }

  function handleSaveListeningQuery() {
    const name = listenSaveName.trim();
    const query = listenQuery.trim();
    if (!name || !query) return;
    setListenSaving(true);
    api
      .createListeningQuery({ name, query })
      .then(() => {
        setListenSaveName("");
        refreshListeningQueries();
      })
      .catch(() => {})
      .finally(() => setListenSaving(false));
  }

  // --- Incidents tool: search/filter the same incident set "My Incidents"
  // polls, plus the Add/Bulk-upload intake modal. ---
  const [incidentFilterOptions, setIncidentFilterOptions] = useState<IncidentFilterOptions | null>(null);
  // Applied filters — what's actually been searched, drives the map/result
  // count. Separate from the draft below so picking several dropdowns
  // doesn't fire a search per click; only the Search button applies them.
  const [incidentFilters, setIncidentFilters] = useState<IncidentFilterState>({});
  const [incidentFilterDraft, setIncidentFilterDraft] = useState<IncidentFilterState>({});
  const [incidentSearchResults, setIncidentSearchResults] = useState<IncidentItem[] | null>(null);
  const [incidentSearchLoading, setIncidentSearchLoading] = useState(false);
  const refreshMyIncidentsRef = useRef<(() => void) | null>(null);
  const [loadAllIncidents, setLoadAllIncidents] = useState(false);
  useEffect(() => {
    myIncidentsLimit = loadAllIncidents ? INCIDENT_ALL_LIMIT : INCIDENT_DEFAULT_LIMIT;
    refreshMyIncidentsRef.current?.();
  }, [loadAllIncidents]);
  const [incidentModalTab, setIncidentModalTab] = useState<"add" | "bulk" | "review" | null>(null);
  const [incidentBulkDeleting, setIncidentBulkDeleting] = useState(false);

  // Raw incident rows backing the "My Incidents" layer on the FLAT map only
  // (Map3D stays on the generic GlobePoint pipeline — see FlatMap below).
  // The generic LAYER_DEFS fetcher above only keeps GlobePoints, which have
  // no room for the fields the rich popup needs (tactic/date/details), so
  // this is polled separately, the same way refreshMyIncidents already
  // re-fetches raw rows after an add/upload.
  const [myIncidentRows, setMyIncidentRows] = useState<IncidentItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    function load() {
      api.getIncidents({ limit: myIncidentsLimit }).then((rows) => !cancelled && setMyIncidentRows(rows)).catch(() => {});
    }
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Approximate territory-change circles (see Map3D.tsx's Map3DTerritoryChange
  // doc comment) — polygon geometry, so it can't go through the generic
  // GlobePoint pipeline above; polled separately the same way myIncidentRows
  // is, and tied to the same Conflict Escalation toggle rather than adding a
  // whole new layer checkbox for one closely-related signal.
  // Countries with an escalation in the last 48 hours, coded by intensity; worked out on the server.
  const [conflictWaveRows, setConflictWaveRows] = useState<ConflictWave[]>([]);
  // Places with a surge of incidents or one serious incident; see IncidentPulses.
  const incidentPulses = useIncidentPulses();
  // A traced aircraft: its stored track, refreshed every minute while it is selected.
  const [selectedAircraft, setSelectedAircraft] = useState<SelectedAircraft | null>(null);
  const [trackHours, setTrackHours] = useState(24);
  const [followAircraft, setFollowAircraft] = useState(false);
  const [aircraftTrack, setAircraftTrack] = useState<AircraftTrack | null>(null);
  const [aircraftTrackError, setAircraftTrackError] = useState<string | null>(null);
  useEffect(() => {
    setAircraftTrack(null);
    setAircraftTrackError(null);
    if (!selectedAircraft) return;
    let cancelled = false;
    const load = () =>
      api
        .getAircraftTrack(selectedAircraft.hex, trackHours)
        .then((t) => !cancelled && (setAircraftTrack(t), setAircraftTrackError(null)))
        .catch((e) => !cancelled && setAircraftTrackError(e instanceof Error ? e.message : "Track unavailable"));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedAircraft, trackHours]);
  const aircraftTrackLine = useMemo<LatLng[]>(() => (aircraftTrack?.points ?? []).map((p) => [p.lat, p.lon] as LatLng), [aircraftTrack]);
  const [activeRows, setActiveRows] = useState<ActiveCountry[]>([]);
  const [activeConfigured, setActiveConfigured] = useState<boolean | null>(null);
  /** The conflict key is hidden until asked for, so it doesn't sit over the map. */
  const [conflictKeyOpen, setConflictKeyOpen] = useState(false);
  const [fireHistory, setFireHistory] = useState<FireHistoryDays | null>(null);
  const [fireDate, setFireDate] = useState<string | null>(null);
  const [firePlaying, setFirePlaying] = useState(false);
  const [fireData, setFireData] = useState<{ collection: LiveLayerCollection | null; cells: boolean }>({ collection: null, cells: false });
  const [fireRangeMode, setFireRangeMode] = useState<FireRangeMode>("day");
  const [fireOnlyUnusual, setFireOnlyUnusual] = useState(false);
  const fireOn = enabled["firms-fires"];
  useEffect(() => {
    fireSinkRef.current = (collection, cells) => setFireData({ collection, cells });
    return () => { fireSinkRef.current = null; };
  }, []);
  // Shows a fire view on the map: loads it, then updates the satellite layer and the flat map.
  const applyFireView = useCallback((view: FireView) => {
    fireViewRef.current = view;
    fetchFireView(view)
      .then(({ collection, cells }) => {
        if (fireViewRef.current !== view) return;
        setFireData({ collection, cells });
        setLayers((prev) => ({ ...prev, "firms-fires": { data: fromGateway("#ff7a1a", "Fire Detections (NASA FIRMS)")(collection), loading: false, error: null } }));
      })
      .catch((err) => setLayers((prev) => ({ ...prev, "firms-fires": { ...prev["firms-fires"], loading: false, error: err instanceof Error ? err.message : "Feed unavailable" } })));
  }, []);
  // The timeline picks a day; in the range view that day is the end of the range.
  const viewFor = (mode: FireRangeMode, date: string): FireView => {
    const from = fireRangeFrom(mode, date);
    return from ? { mode: "range", from, to: date } : { mode: "day", date };
  };
  const selectFireDay = useCallback((date: string) => {
    setFireDate(date);
    applyFireView(viewFor(fireRangeMode, date));
  }, [fireRangeMode, applyFireView]);
  const setRangeMode = useCallback((mode: FireRangeMode) => {
    setFireRangeMode(mode);
    const date = fireDate ?? fireHistory?.days[fireHistory.days.length - 1]?.date;
    if (!date) return;
    setFireDate(date);
    applyFireView(viewFor(mode, date));
  }, [fireDate, fireHistory, applyFireView]);
  // Stored fire history for the timeline: refreshed every ten minutes while the layer is on.
  useEffect(() => {
    if (!fireOn) return;
    let cancelled = false;
    function load() {
      api.getFireHistoryDays(30).then((h) => !cancelled && setFireHistory(h)).catch(() => {});
    }
    load();
    const interval = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fireOn]);
  // Opens on the latest day once the history arrives.
  useEffect(() => {
    const days = fireHistory?.days ?? [];
    if (days.length === 0) return;
    if (!fireDate || !days.some((d) => d.date === fireDate)) {
      // A shared link names its day; open on it when the timeline has it.
      const linked = fireDate ? null : readViewParams().date;
      selectFireDay(linked && days.some((d) => d.date === linked) ? linked : days[days.length - 1].date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fireHistory]);
  // Playing steps the timeline once a second (see FireTimeline).
  const fireUnusual = useMemo(() => unusualFireDays(fireHistory?.days ?? [], fireHistory?.coveredFrom), [fireHistory]);
  const [worldOutlines, setWorldOutlines] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    if (!enabled["active-conflicts"]) return;
    let cancelled = false;
    loadWorldCountries().then((w) => !cancelled && setWorldOutlines(w)).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled["active-conflicts"]]);
  // Escalation rings: always on, polled from the conflict-zones endpoint (its country list is no longer drawn).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.getConflictZones().then((z) => {
        if (cancelled) return;
        setConflictWaveRows(z.waves ?? []);
      }).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!enabled["active-conflicts"]) {
      setActiveRows([]);
      return;
    }
    let cancelled = false;
    const loadActive = () =>
      api.getActiveConflicts().then((a) => {
        if (cancelled) return;
        setActiveRows(a.countries ?? []);
        setActiveConfigured(a.configured);
      }).catch(() => {});
    loadActive();
    const activeTimer = setInterval(loadActive, 6 * 3_600_000);
    return () => { cancelled = true; clearInterval(activeTimer); };
  }, [enabled["active-conflicts"]]);
  const activeConflictMap = useMemo(
    () => {
      if (!enabled["active-conflicts"] || !worldOutlines) return null;
      return activeCountryFeatures(worldOutlines, activeRows);
    },
    [enabled["active-conflicts"], worldOutlines, activeRows]
  );
  const conflictWaveMap = useMemo(
    () => waveFeatures([...conflictWaveRows, ...pulsesAsWaves(incidentPulses, conflictWaveRows)]),
    [conflictWaveRows, incidentPulses]
  );
  const [territoryChangePolygons, setTerritoryChangePolygons] = useState<Map3DTerritoryChange[]>([]);
  useEffect(() => {
    if (!enabled["conflict-escalation"]) {
      setTerritoryChangePolygons([]);
      return;
    }
    let cancelled = false;
    function load() {
      api
        .getTerritoryChanges()
        .then((collection) => {
          if (cancelled) return;
          setTerritoryChangePolygons(
            collection.features.map((f) => ({
              id: f.properties.id,
              ring: f.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]),
              title: f.properties.title,
              detail: f.properties.detail,
              time: f.properties.time,
              url: f.properties.url,
            }))
          );
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);
  // An active search narrows the rich layer exactly like it narrows the
  // generic GlobePoint one above (see `points` memo).
  const incidentRowsForFlatMap = useMemo(
    () => (incidentSearchResults ?? myIncidentRows).filter((r) => r.latitude != null && r.longitude != null),
    [incidentSearchResults, myIncidentRows]
  );

  // Display options for the rich incident layer — mirrors IncidentsMap.tsx/
  // IncidentSearch.tsx's own view-mode + heatmap controls, session-only.
  const [incidentViewMode, setIncidentViewMode] = useState<"markers" | "heatmap">("markers");
  /** Icons by default; true groups nearby icons into numbered count bubbles. */
  const [incidentBubbles, setIncidentBubbles] = useState(false);
  const [incidentIconMode, setIncidentIconMode] = useState<"actor" | "tactic">("actor");
  const [incidentHeatmapStyle, setIncidentHeatmapStyle] = useState<HeatmapStyle>(DEFAULT_HEATMAP_STYLE);
  const [incidentAnnotations, setIncidentAnnotations] = useState<Record<string, PopupAnnotation>>({});
  const updateIncidentAnnotation = useCallback((incidentId: string, patch: Partial<PopupAnnotation>) => {
    setIncidentAnnotations((prev) => ({ ...prev, [incidentId]: { ...prev[incidentId], ...patch } }));
  }, []);

  // Hide-on-map (shared with the Mapping/Search maps — see hiddenIncidents.tsx)
  // and delete-from-popup. A delete is removed from every local copy at once
  // (flat-map rows, active search results, and the 3D globe's layer points)
  // rather than waiting for the next poll.
  const hiddenIncidents = useHiddenIncidents();
  const { forget: forgetHiddenIncident } = hiddenIncidents;
  const handleIncidentDeleted = useCallback(
    (id: string) => {
      setMyIncidentRows((prev) => prev.filter((r) => r.id !== id));
      setIncidentSearchResults((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      setLayers((prev) => {
        const layer = prev["my-incidents"];
        if (!layer?.data) return prev;
        return { ...prev, "my-incidents": { ...layer, data: layer.data.filter((p) => p.id !== id) } };
      });
      forgetHiddenIncident([id]);
    },
    [forgetHiddenIncident]
  );

  // --- Crypto Intel tool: on-chain wallet lookup (BTC/ETH/SOL), adapted
  // from the reference platform's chainIntel — see api.getCryptoIntel's own comment. Not a
  // map layer: this is a one-off lookup a user runs, not a polled feed. ---
  const [cryptoAddress, setCryptoAddress] = useState("");
  const [cryptoChain, setCryptoChain] = useState<ChainKind | "">("");
  const [cryptoResult, setCryptoResult] = useState<WalletIntel | null>(null);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  function runCryptoLookup() {
    const address = cryptoAddress.trim();
    if (!address) return;
    setCryptoLoading(true);
    setCryptoError(null);
    api
      .getCryptoIntel(address, cryptoChain || undefined)
      .then(setCryptoResult)
      .catch((e) => setCryptoError(e instanceof Error ? e.message : "Lookup failed"))
      .finally(() => setCryptoLoading(false));
  }
  const [incidentExporting, setIncidentExporting] = useState<"xlsx" | "csv" | null>(null);

  // --- Shapes tool: persisted AOI overlays (map_shapes), drawn here and
  // shown on the map alongside every live layer and incident. ---
  const [savedShapes, setSavedShapes] = useState<SavedShape[]>([]);

  // --- Saved routes (map_routes) — the Route tool's planned routes can be
  // saved here, so they persist and overlay the map (and any incidents)
  // alongside everything else, rather than vanishing once the tool closes. ---
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [routeNameDraft, setRouteNameDraft] = useState("");
  const [routeSaving, setRouteSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getMapShapes(), api.getMapRoutes()])
      .then(([shapes, routes]) => {
        if (cancelled) return;
        setSavedShapes(shapes);
        setSavedRoutes(routes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function refreshShapes() {
    api.getMapShapes().then(setSavedShapes).catch(() => {});
  }
  // Map Studio saves through its own store; it asks for a fresh list after each change.
  const refreshShapesRef = useRef(refreshShapes);
  refreshShapesRef.current = refreshShapes;
  useEffect(() => {
    studio.configure({ onChanged: () => refreshShapesRef.current() });
  }, []);
  // The globe hands over its MapLibre map so the Studio can draw on it.
  const [globeMap, setGlobeMap] = useState<MapLibreMap | null>(null);
  // Label language: only MapTiler's SDK map (the globe with the key) can change it; its vector labels follow.
  useEffect(() => {
    const m = globeMap as unknown as { setLanguage?: (l: string) => void } | null;
    if (!m?.setLanguage) return;
    try {
      m.setLanguage(labelLang);
    } catch {
      /* style not ready; the SDK applies it on load */
    }
  }, [globeMap, labelLang]);
  // Switching views: load the other view the first time, and carry the place across, so the map opens where the
  // last one was. MapLibre's zoom is one step below Leaflet's for the same scale (512 against 256 tiles).
  useEffect(() => {
    const prev = viewModeRef.current;
    viewModeRef.current = mapMode;
    if (mapMode === "3d") setGlobeMounted(true);
    else setFlatMounted(true);
    if (prev === mapMode) return;
    if (mapMode === "3d" && flatMap && globeMap) {
      const c = flatMap.getCenter();
      globeMap.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(0, flatMap.getZoom() - 1) });
      globeMap.resize();
    } else if (mapMode !== "3d" && flatMap) {
      requestAnimationFrame(() => {
        flatMap.invalidateSize({ animate: false });
        if (globeMap) {
          const c = globeMap.getCenter();
          flatMap.setView([Math.max(-85, Math.min(85, c.lat)), c.lng], Math.max(2, Math.round(globeMap.getZoom() + 1)), { animate: false });
        }
      });
    }
  }, [mapMode, flatMap, globeMap]);

  // "Save map image": the 3D globe as drawn (Lens layers included), read from its canvas in the frame it is drawn;
  // the flat map as a MapTiler static image of the same place and basemap (basemap only; needs the key).
  const saveMapImage = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const download = (href: string) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = `lens-map-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (mapMode === "3d" && globeMap) {
      globeMap.once("render", () => {
        try {
          download(globeMap.getCanvas().toDataURL("image/png"));
        } catch {
          window.alert("The map image could not be saved (a basemap without image permissions is shown).");
        }
      });
      globeMap.triggerRepaint();
      return;
    }
    const key = maptilerKey();
    if (!flatMap || !key) {
      window.alert("Saving the flat map as an image needs the MapTiler key in Settings. The 3D globe can be saved without it.");
      return;
    }
    const c = flatMap.getCenter();
    const size = flatMap.getSize();
    const w = Math.min(2048, Math.round(size.x / 2)), h = Math.min(2048, Math.round(size.y / 2));
    const style = basemapStyleId(basemap);
    window.open(`https://api.maptiler.com/maps/${style}/static/${c.lng.toFixed(5)},${c.lat.toFixed(5)},${Math.max(0, flatMap.getZoom() - 1).toFixed(2)}/${w}x${h}@2x.png?key=${key}`, "_blank", "noopener");
  }, [mapMode, globeMap, flatMap, basemap]);
  // Keyboard shortcuts, as the reference platform has: F flights, E earthquakes, S satellites, D day/night, O opens AfrIntel, Esc closes the side panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const flip = (keys: string[]) => setEnabled((prev) => { const on = !keys.every((k) => prev[k]); return { ...prev, ...Object.fromEntries(keys.map((k) => [k, on])) }; });
      const k = e.key.toLowerCase();
      if (k === "f") flip(["air-traffic-commercial", "air-traffic-private", "air-traffic-jets", "air-traffic-military"]);
      else if (k === "e") flip(["earthquakes"]);
      else if (k === "s") flip(["satellites-all"]);
      else if (k === "d") setShowDayNight((v) => !v);
      else if (k === "a" && canAfrIntel) setActiveTool((prev) => (prev === "afrintel" ? null : "afrintel"));
      else if (e.key === "Escape") { setSelectedAircraft(null); setMap3DSelectedFeature(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // A Locate request from Live Alerts, on the 3D map.
  useEffect(() => {
    if (!focus || mapMode !== "3d" || !globeMap) return;
    globeMap.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom, duration: 1200 });
  }, [focus, mapMode, globeMap]);
  // Following on the 3D map: keep the globe centred on the aircraft's latest position.
  useEffect(() => {
    if (!followAircraft || mapMode !== "3d" || !globeMap) return;
    const last = aircraftTrack?.points[aircraftTrack.points.length - 1];
    if (last) globeMap.easeTo({ center: [last.lon, last.lat], duration: 800 });
  }, [followAircraft, aircraftTrack, mapMode, globeMap]);
  const studioState = useStudio();
  // Corners of a measured line or area, and a route's start and end, can be dragged to adjust them.
  const editPoints: EditPoint[] =
    activeTool === "draw" && drawMode
      ? drawPoints.map((p, i) => ({ id: `d${i}`, lat: p[0], lng: p[1], color: "#ffd23f", label: `Point ${i + 1}: drag to move` }))
      : activeTool === "route"
        ? [
            ...(routeOrigin ? [{ id: "o", lat: routeOrigin[0], lng: routeOrigin[1], color: "#4dff9e", label: "Start: drag to move" }] : []),
            ...(routeDestination ? [{ id: "d", lat: routeDestination[0], lng: routeDestination[1], color: "#ff6b6b", label: "End: drag to move" }] : []),
          ]
        : [];
  // A radius search around a route or layer: it narrows the map's incidents to the matches, and can show them as a heatmap.
  const [nearby, setNearby] = useState<NearbyState | null>(null);
  const [routeStyle, setRouteStyle] = useState<RouteStyle>(DEFAULT_ROUTE_STYLE);
  function applyNearby(rows: IncidentItem[] | null, s: NearbyState | null) {
    setIncidentSearchResults(rows);
    setNearby(s);
    if (rows) setEnabled((prev) => ({ ...prev, "my-incidents": true }));
  }
  function showNearbyAs(m: "markers" | "heatmap") {
    setIncidentViewMode(m);
    setEnabled((prev) => ({ ...prev, "my-incidents": true }));
  }
  const routeFeature: GeoJSON.Feature | null =
    routeResult && routeResult.coordinates.length >= 2 ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeResult.coordinates } } : null;
  async function saveRouteAsLayer() {
    if (!routeFeature) return;
    const row = await createShape(routeFeature, {
      name: routeNameDraft.trim() || "Route",
      style: { ...DEFAULT_STYLE, color: routeStyle.color, weight: routeStyle.weight, strokeOpacity: routeStyle.opacity, dashArray: routeStyle.dash },
      source: "drawn",
    });
    if (row) {
      setRouteNameDraft("");
      setActiveTool("shapes");
      studio.set({ tool: "select", selectedId: row.id });
    }
  }
  // Keeps a measured line or area as a Map Studio layer, which is saved and can be styled and edited.
  async function saveDrawingAsLayer() {
    if (!drawMode) return;
    const ll = drawPoints.map(([lat, lng]) => [lng, lat]);
    const geometry: GeoJSON.Geometry | null =
      drawMode === "distance" && ll.length >= 2 ? { type: "LineString", coordinates: ll } : drawMode === "area" && ll.length >= 3 ? { type: "Polygon", coordinates: [[...ll, ll[0]]] } : null;
    if (!geometry) return;
    const row = await createShape({ type: "Feature", properties: {}, geometry }, { name: drawMode === "distance" ? "Measured line" : "Measured area", style: { ...DEFAULT_STYLE, color: "#ffd23f", fillColor: "#ffd23f" }, source: "drawn" });
    if (row) {
      setDrawPoints([]);
      setActiveTool("shapes");
      studio.set({ tool: "select", selectedId: row.id });
    }
  }
  function moveEditPoint(id: string, lat: number, lng: number) {
    if (id === "o") setRouteOrigin([lat, lng]);
    else if (id === "d" && activeTool === "route") setRouteDestination([lat, lng]);
    else if (id.startsWith("d")) setDrawPoints((prev) => prev.map((p, i) => (i === Number(id.slice(1)) ? ([lat, lng] as LatLng) : p)));
  }
  // Files dropped on the map open the Studio's import tab.
  useEffect(() => {
    if (studioState.dropped?.length) setActiveTool("shapes");
  }, [studioState.dropped]);
  function refreshRoutes() {
    api.getMapRoutes().then(setSavedRoutes).catch(() => {});
  }

  // Refetches both the base "My Incidents" layer and, if a search is
  // active, the filtered result set — called right after an Add-one or
  // Bulk-upload save so a freshly-entered incident appears immediately
  // instead of waiting for the next 60s poll.
  function refreshMyIncidents() {
    refreshMyIncidentsRef.current = refreshMyIncidents;
    api
      .getIncidents({ limit: myIncidentsLimit })
      .then((rows) => {
        setLayers((prev) => ({
          ...prev,
          "my-incidents": { data: rows.map(incidentRowToPoint).filter((p): p is GlobePoint => p !== null), loading: false, error: null },
        }));
        setMyIncidentRows(rows);
      })
      .catch(() => {});
    if (Object.values(incidentFilters).some(Boolean)) {
      api.getIncidents({ ...incidentFilters, limit: INCIDENT_ALL_LIMIT }).then(setIncidentSearchResults).catch(() => {});
    }
  }

  // Bulk-deletes every incident currently matched by the Incidents tool's
  // filters (i.e. exactly what's highlighted on the map right now). Reuses
  // the same /api/incidents/bulk-delete endpoint as the Manage/Uploads
  // table, just scoped to the live-search result set instead of a manual
  // checkbox selection.
  function handleBulkDeleteFilteredIncidents() {
    const rows = incidentSearchResults;
    if (!rows || rows.length === 0) return;
    const count = rows.length;
    if (!window.confirm(`Delete all ${count.toLocaleString()} matching incident${count === 1 ? "" : "s"} from the map? This can't be undone.`)) {
      return;
    }
    setIncidentBulkDeleting(true);
    api
      .bulkDeleteIncidents(rows.map((r) => r.id))
      .then(() => {
        setIncidentSearchResults([]);
        refreshMyIncidents();
      })
      .catch(() => {})
      .finally(() => setIncidentBulkDeleting(false));
  }

  useEffect(() => {
    if (activeTool !== "incidents" || incidentFilterOptions) return;
    api.getIncidentFilters().then(setIncidentFilterOptions).catch(() => {});
  }, [activeTool, incidentFilterOptions]);

  // Fires only when the applied filters change — i.e. when Search or Clear
  // is clicked below, not on every dropdown/date edit (the draft holds
  // those in between). Searches are not capped: every matching incident is
  // fetched and shown.
  useEffect(() => {
    const hasFilter = Object.values(incidentFilters).some(Boolean);
    if (!hasFilter) {
      setIncidentSearchResults(null);
      return;
    }
    let cancelled = false;
    setIncidentSearchLoading(true);
    api
      .getIncidents({ ...incidentFilters, limit: INCIDENT_ALL_LIMIT })
      .then((rows) => {
        if (!cancelled) setIncidentSearchResults(rows);
      })
      .catch(() => {
        if (!cancelled) setIncidentSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setIncidentSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentFilters]);

  function handleIncidentSearch() {
    setIncidentFilters(incidentFilterDraft);
  }

  function handleIncidentClearFilters() {
    setIncidentFilterDraft({});
    setIncidentFilters({});
  }

  // Exports every incident currently matched by the applied filters — the
  // full set, not just the 2000-point cap the map itself renders. Fetches
  // fresh at click-time so the export always reflects "Search" having been
  // pressed, not whatever's mid-edit in the draft.
  async function handleIncidentExport(format: "xlsx" | "csv") {
    if (!exportAllowed()) return;
    setIncidentExporting(format);
    try {
      const rows = await api.getIncidents({ ...incidentFilters, limit: 250000 });
      const records = rows.map((i) => ({
        Date: i.occurred_date,
        Time: i.occurred_time,
        Country: i.country,
        Province: i.province,
        County: i.county,
        District: i.district,
        City: i.city,
        Suburb: i.suburb,
        "Precise Location": i.precise_location,
        Latitude: i.latitude,
        Longitude: i.longitude,
        Sector: i.sector,
        Actor: i.actor,
        Operation: i.operation,
        Tactic: i.tactic,
        Severity: i.severity,
        Details: i.details,
        Target: i.target,
        "Interest Group": i.interest_group,
        "Actual Main Victim": i.actual_main_victim,
        "Intended Primary Target": i.intended_primary_target,
        "Civilian Death - Child": i.civilian_death_child,
        "Civilian Death - Female": i.civilian_death_female,
        "Civilian Death - Male": i.civilian_death_male,
        "Civilian Death - Unknown": i.civilian_death_unknown,
        "Civilian Injury - Female": i.civilian_injury_female,
        "Civilian Injury - Male": i.civilian_injury_male,
        "Civilian Injury - Unknown": i.civilian_injury_unknown,
        "Kidnappings - Ngo": i.kidnappings_ngo,
      }));
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "xlsx") {
        // Lazy-imported — keeps the ~400KB xlsx parser out of this view's
        // main chunk for the (common) case export is never clicked.
        const XLSX = await import("xlsx");
        const sheet = XLSX.utils.json_to_sheet(records);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "Incidents");
        XLSX.writeFile(workbook, `incidents_${stamp}.xlsx`);
      } else {
        const headers = records.length > 0 ? Object.keys(records[0]) : [];
        const escape = (v: unknown) => {
          const s = v === null || v === undefined ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [headers.join(","), ...records.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `incidents_${stamp}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // best-effort export; the panel's disabled state already prevents
      // double-clicks, nothing further to surface on failure here
    } finally {
      setIncidentExporting(null);
    }
  }

  // A click on the map/globe means something different depending on which
  // right-side tool is open: adds the next drawing vertex, or sets
  // whichever of origin/destination isn't picked yet (a third click starts
  // a fresh pair rather than silently doing nothing).
  function handleMapClick(lat: number, lng: number) {
    if (activeTool === "draw" && drawMode) {
      setDrawPoints((prev) => [...prev, [lat, lng]]);
    } else if (activeTool === "route") {
      if (!routeOrigin) setRouteOrigin([lat, lng]);
      else if (!routeDestination) setRouteDestination([lat, lng]);
      else {
        setRouteOrigin([lat, lng]);
        setRouteDestination(null);
        setRouteResult(null);
        setRouteError(null);
      }
    }
  }

  async function handleSaveRoute() {
    if (!routeResult || routeResult.coordinates.length < 2) return;
    setRouteSaving(true);
    try {
      const geometry = routeResult.coordinates.map(([lng, lat]) => [lat, lng] as LatLng);
      const waypoints = [routeOrigin, routeDestination].filter((p): p is LatLng => p !== null);
      await api.createMapRoute({
        name: routeNameDraft.trim() || "Untitled route",
        mode: "road",
        waypoints: waypoints.length >= 2 ? waypoints : geometry.slice(0, 2),
        geometry,
        distance_km: routeResult.distanceMeters / 1000,
        duration_min: routeResult.durationSeconds / 60,
        color: routeStyle.color,
      });
      setRouteNameDraft("");
      refreshRoutes();
    } catch {
      // Best-effort — the route stays visible in the planner either way,
      // this only affects whether it's also persisted for later.
    } finally {
      setRouteSaving(false);
    }
  }

  useEffect(() => {
    if (!routeOrigin || !routeDestination) return;
    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);
    api
      .getLiveRoute(routeOrigin, routeDestination, routeMode)
      .then((result) => {
        if (cancelled) return;
        setRouteResult(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setRouteResult(null);
        setRouteError(err instanceof Error ? err.message : "Route unavailable");
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeOrigin, routeDestination, routeMode]);

  useEffect(() => {
    if (activeTool !== "space") return;
    let cancelled = false;
    async function poll() {
      try {
        const pos = await api.getLiveIss();
        if (!cancelled) {
          setIssPos(pos);
          setIssError(null);
        }
      } catch (err) {
        if (!cancelled) setIssError(err instanceof Error ? err.message : "ISS feed unavailable");
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTool]);

  useEffect(() => {
    let cancelled = false;
    const pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
    async function loadLayer(def: LayerDef) {
      setLayers((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loading: true } }));
      try {
        const data = await def.fetcher();
        if (cancelled) return;
        setLayers((prev) => ({ ...prev, [def.key]: { data, loading: false, error: null } }));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Feed unavailable";
        setLayers((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loading: false, error: message } }));
      }
    }
    // Staggered rather than all fired in the same tick — several of these
    // layers (GDELT Events, Global Incidents, plus the Activity Index HUD
    // ticker elsewhere) all hit GDELT's free API, which rate-limits
    // aggressively under concurrent load. Loading the page used to fire
    // every layer's first request in the same instant, which was almost
    // certainly compounding the 429s on top of GDELT's own shared,
    // cross-customer rate limit — this spreads that initial burst out
    // instead of relying on retries alone to paper over it.
    const LAYER_STAGGER_MS = 400;
    function loadAllLayersStaggered() {
      LAYER_DEFS.forEach((def, i) => {
        pendingTimeouts.push(setTimeout(() => loadLayer(def), i * LAYER_STAGGER_MS));
      });
    }
    loadAllLayersStaggered();
    const interval = setInterval(loadAllLayersStaggered, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      pendingTimeouts.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const points = useMemo(() => {
    const all: GlobePoint[] = [];
    for (const def of LAYER_DEFS) {
      if (!enabled[def.key]) continue;
      // An active incidents search overrides the base poll for this one
      // layer — same marker styling (incidentRowToPoint), just a filtered
      // row set, so search visibly narrows what's on the map itself.
      if (def.key === "my-incidents") {
        const rows = incidentSearchResults
          ? incidentSearchResults.map(incidentRowToPoint).filter((p): p is GlobePoint => p !== null)
          : layers[def.key]?.data ?? [];
        // In heatmap view the globe shows the heat layer instead of the bullets.
        if (incidentViewMode === "heatmap") continue;
        // Hidden incidents stay off the 3D globe too, not just the flat map.
        all.push(...(hiddenIncidents.hiddenIds.size ? rows.filter((p) => !hiddenIncidents.hiddenIds.has(p.id)) : rows));
        continue;
      }
      const data = layers[def.key]?.data;
      if (data) all.push(...data);
    }
    return all;
  }, [layers, enabled, incidentSearchResults, hiddenIncidents.hiddenIds, incidentViewMode]);

  // Tool overlays rendered as ordinary GlobePoints — the marker rendering
  // (both the 3D pointsData layer and the flat CircleMarker map) is already
  // generic over color/size/title/subtitle, so a drawing vertex or a route
  // endpoint just piggybacks on that same code path rather than needing its
  // own renderer per map mode.
  const toolPoints = useMemo(() => {
    const extra: GlobePoint[] = [];
    if (activeTool === "space" && issPos) {
      extra.push({
        id: "iss",
        layerKey: "ISS",
        lat: issPos.lat,
        lng: issPos.lng,
        color: "#ffffff",
        size: 0.22,
        title: "International Space Station",
        subtitle: `~${issPos.speedKmh.toLocaleString()} km/h orbital ground speed`,
        time: issPos.timestamp,
        url: null,
      });
    }
    if (activeTool === "route") {
      if (routeOrigin) {
        extra.push({ id: "route-origin", layerKey: "Route", lat: routeOrigin[0], lng: routeOrigin[1], color: "#4dff9e", size: 0.2, title: "Origin", subtitle: "", time: null, url: null });
      }
      if (routeDestination) {
        extra.push({ id: "route-destination", layerKey: "Route", lat: routeDestination[0], lng: routeDestination[1], color: "#ff5d5d", size: 0.2, title: "Destination", subtitle: "", time: null, url: null });
      }
    }
    if (activeTool === "draw") {
      drawPoints.forEach(([lat, lng], i) => {
        extra.push({ id: `draw-${i}`, layerKey: "Drawing", lat, lng, color: "#ffd23f", size: 0.14, title: `Point ${i + 1}`, subtitle: "", time: null, url: null });
      });
    }
    // The Listen tool's current ad-hoc search result — geocoded coverage
    // locations for whatever's in the query box right now, shown only
    // while the tool is open (a live preview, not a persisted layer; save
    // + pin the query to keep it on the map after closing the tool — see
    // listeningLayerPoints below).
    if (activeTool === "listen" && listenResult) {
      for (const gp of listenResult.geoPoints) {
        extra.push({
          id: `listen-search-${gp.id}`,
          layerKey: "Listening (search)",
          lat: gp.lat,
          lng: gp.lng,
          color: HUD.cyan,
          size: Math.max(0.12, Math.min(0.3, gp.count / 40)),
          title: gp.title,
          subtitle: `${listenResult.query} — ${gp.detail}`.slice(0, 160),
          time: null,
          url: null,
        });
      }
    }
    return extra;
  }, [activeTool, issPos, routeOrigin, routeDestination, drawPoints, listenResult]);

  // Pinned, toggled-on saved listening queries — a persistent map layer
  // (unlike the ad-hoc search preview above), driven by the same polling
  // that feeds the left-rail tone badges (listeningLiveData), so turning a
  // query on in the left rail plots its coverage on the map immediately and
  // keeps it current, independent of whether the Listen tool panel is open.
  const listeningLayerPoints = useMemo(() => {
    const extra: GlobePoint[] = [];
    for (const sq of savedListeningQueries) {
      if (!activeListeningIds.has(sq.id)) continue;
      const live = listeningLiveData[sq.id];
      if (!live) continue;
      for (const gp of live.geoPoints) {
        extra.push({
          id: `listen-${sq.id}-${gp.id}`,
          layerKey: `Listening: ${sq.name}`,
          lat: gp.lat,
          lng: gp.lng,
          color: HUD.gold,
          size: Math.max(0.12, Math.min(0.3, gp.count / 40)),
          title: gp.title,
          subtitle: `${sq.name} — ${gp.detail}`.slice(0, 160),
          time: null,
          url: null,
        });
      }
    }
    return extra;
  }, [savedListeningQueries, activeListeningIds, listeningLiveData]);

  const afrIntelPoints = useMemo(() => {
    const out: GlobePoint[] = afrIntelMarks.map((m, i) => ({ id: `afrintel-mark-${i}`, layerKey: "AfrIntel marks", lat: m.lat, lng: m.lng, color: "#22d3ee", size: 0.5, title: m.title, subtitle: "Marked by AfrIntel Assist", time: null, url: m.url }));
    for (const a of afrIntelRun?.actors ?? []) {
      if (a.lat == null || a.lng == null) continue;
      out.push({ id: `afrintel-actor-${a.id}`, layerKey: "AfrIntel actors", lat: a.lat, lng: a.lng, color: "#22d3ee", size: 0.42, title: `${a.name} (${a.kind})`, subtitle: `AfrIntel forecast actor: ${a.stance}`.slice(0, 220), time: null, url: null, details: a.goal ? `Goal: ${a.goal}` : undefined });
    }
    return out;
  }, [afrIntelMarks, afrIntelRun]);
  const mapPoints = useMemo(() => [...points, ...toolPoints, ...listeningLayerPoints, ...monitorLayerPoints, ...afrIntelPoints], [points, toolPoints, listeningLayerPoints, monitorLayerPoints, afrIntelPoints]);
  // Flat map renders "My Incidents" through the rich IncidentMarker/heatmap
  // layer below instead of a generic colored dot — drop the generic version
  // here so the same incidents don't appear twice on the 2D/map/sat modes.
  // Map3D (3D mode) keeps the generic GlobePoint version via `mapPoints`.
  // Satellite fires are drawn by FireMapLayer on the flat maps (heat, then framed points), so the generic dots are left out there.
  const flatMapPoints = useMemo(() => mapPoints.filter((p) => p.layerKey !== "My Incidents" && p.layerKey !== "Fire Detections (NASA FIRMS)"), [mapPoints]);

  // Draw/route lines, merged alongside the shipping lanes for the 3D globe's
  // single pathsData layer — a color field on each entry (shipping lanes
  // have none, so they fall back to their usual blue) is what tells
  // pathColor apart, rather than needing three separate path layers.
  const globePaths = useMemo(() => {
    const lanes = enabled["maritime-lines"] ? maritimeLanes : [];
    const cables = enabled["submarine-cables"] ? submarineCables : [];
    const drawPath =
      drawMode === "distance" && drawPoints.length >= 2 ? [{ points: drawPoints, label: "Measured distance", color: "#ffd23f" }] : [];
    const routePath =
      routeResult && routeResult.coordinates.length >= 2
        ? [{ points: routeResult.coordinates.map(([lng, lat]) => [lat, lng] as LatLng), label: "Route", color: routeStyle.color, width: routeStyle.weight }]
        : [];
    const routeOverlays = savedRoutes
      .filter((r) => r.visible)
      .map((r) => ({ points: r.geometry as LatLng[], label: r.name, color: r.color || "#4dff9e" }))
      .filter((p) => p.points.length >= 2);
    const flightPath = aircraftTrackLine.length >= 2 ? [{ points: aircraftTrackLine, label: selectedAircraft?.label ?? "Flight track", color: "#ffd23f", width: 3 }] : [];
    const byId = new Map((afrIntelRun?.actors ?? []).map((x) => [x.id, x]));
    const afrIntelLinks = (afrIntelRun?.links ?? []).flatMap((l) => {
      const p = byId.get(l.from), q = byId.get(l.to);
      if (!p || !q || p.lat == null || p.lng == null || q.lat == null || q.lng == null) return [];
      return [{ points: [[p.lat, p.lng], [q.lat, q.lng]] as LatLng[], label: `${p.name} – ${q.name}: ${l.relation}`, color: "#22d3ee", width: 1.5 }];
    });
    return [...lanes, ...cables, ...drawPath, ...routePath, ...routeOverlays, ...flightPath, ...afrIntelLinks];
  }, [
    enabled["maritime-lines"],
    maritimeLanes,
    aircraftTrackLine,
    selectedAircraft,
    afrIntelRun,
    enabled["submarine-cables"],
    submarineCables,
    drawMode,
    drawPoints,
    routeResult,
    routeStyle,
    activeTool,
    savedRoutes,
  ]);
  // The lines both views draw the same way (lanes, cables, AfrIntel links): the flat map draws its own draw, route and
  // flight lines, so it takes only these.
  const sharedPaths = useMemo(() => {
    const lanes = enabled["maritime-lines"] ? maritimeLanes : [];
    const cables = enabled["submarine-cables"] ? submarineCables : [];
    const byId = new Map((afrIntelRun?.actors ?? []).map((x) => [x.id, x]));
    const afrIntelLinks = (afrIntelRun?.links ?? []).flatMap((l) => {
      const p = byId.get(l.from), q = byId.get(l.to);
      if (!p || !q || p.lat == null || p.lng == null || q.lat == null || q.lng == null) return [];
      return [{ points: [[p.lat, p.lng], [q.lat, q.lng]] as LatLng[], label: `${p.name} – ${q.name}: ${l.relation}`, color: "#22d3ee", width: 1.5 }];
    });
    return [...lanes, ...cables, ...afrIntelLinks];
  }, [enabled, maritimeLanes, submarineCables, afrIntelRun]);

  // The in-progress area-drawing shape, as a closed ring — country borders
  // themselves no longer need to be built here at all now that the 3D view
  // is a real vector-tile basemap (Map3D) that already draws them as part
  // of its own style.
  const drawAreaRing = useMemo<LatLng[] | null>(() => {
    if (drawMode !== "area" || drawPoints.length < 3) return null;
    return [...drawPoints, drawPoints[0]];
  }, [drawMode, drawPoints]);

  // The same incidents as a heatmap on the 3D globe (the flat maps draw theirs themselves).
  const globeHeatPoints = useMemo(() => {
    if (!enabled["my-incidents"] || incidentViewMode !== "heatmap") return null;
    const rows = hiddenIncidents.hiddenIds.size ? incidentRowsForFlatMap.filter((r) => !hiddenIncidents.hiddenIds.has(r.id)) : incidentRowsForFlatMap;
    return incidentHeatPoints(rows, incidentHeatmapStyle);
  }, [enabled["my-incidents"], incidentViewMode, incidentRowsForFlatMap, hiddenIncidents.hiddenIds, incidentHeatmapStyle]);

  const routeLineForFlatMap = useMemo<LatLng[] | undefined>(
    () => (routeResult ? routeResult.coordinates.map(([lng, lat]) => [lat, lng] as LatLng) : undefined),
    [routeResult]
  );

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#000308",
        color: "#d7e4f2",
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
      }}
    >
      <div
        // The zoom pad keeps clear of the tool rail, and of a tool's own panel when one is open beside it.
        style={{ position: "relative", flex: 1, ["--lens-pad-left" as string]: leftOpen ? "284px" : "10px", ["--lens-pad-right" as string]: rightOpen ? (rightTool === "economy" ? "min(648px, 55%)" : rightTool && rightTool !== "analyses" ? "min(488px, 45%)" : "84px") : "12px" }}
      >
        {/* Both views stay loaded once used, and switching only shows one and hides the other (carrying the view
            across), so it is instant; the hidden globe pauses its animations. */}
        <div style={{ position: "absolute", inset: 0, visibility: mapMode === "3d" ? "visible" : "hidden", pointerEvents: mapMode === "3d" ? "auto" : "none" }}>
          {globeMounted && (
          <Map3D
            basemap={basemap}
            active={mapMode === "3d"}
            points={mapPoints}
            paths={globePaths}
            territoryChanges={territoryChangePolygons}
            activeConflictMap={activeConflictMap}
            conflictWaves={conflictWaveMap}
            drawAreaRing={drawAreaRing}
            onMapClick={handleMapClick}
            onMapReady={setGlobeMap}
            heatPoints={globeHeatPoints}
            heatStyle={incidentHeatmapStyle}
            onFeatureSelect={(f) => {
              if (f && f.kind === "point" && AIRCRAFT_LAYER_KEYS.has(f.layerKey)) {
                setSelectedAircraft({ hex: f.id, label: f.title });
                setMap3DSelectedFeature(null);
                return;
              }
              setMap3DSelectedFeature(f);
            }}
            showDayNight={showDayNight}
            showBuildings={showBuildings}
            showTerrain={showTerrain}
            showNav={showNav}
          />
          )}
        </div>
        <div style={{ position: "absolute", inset: 0, visibility: mapMode !== "3d" ? "visible" : "hidden", pointerEvents: mapMode !== "3d" ? "auto" : "none" }}>
          {flatMounted && (
          <FlatMap
            basemap={basemap}
            onReady={setFlatMap}
            points={flatMapPoints}
            sharedPaths={sharedPaths}
            territoryChanges={territoryChangePolygons}
            activeConflictMap={activeConflictMap}
            conflictWaveRows={conflictWaveRows}
            incidentPulses={incidentPulses}
            aircraftTrack={aircraftTrackLine}
            rainOn={!!enabled["rain-radar"]}
            cloudsOn={!!enabled["live-clouds"]}
            focus={focus}
            showNav={showNav}
            followAircraft={followAircraft}
            onAircraftClick={(hex, label) => setSelectedAircraft({ hex, label })}
            selectedAircraftId={selectedAircraft?.hex ?? null}
            onLayersOn={(keys) => setEnabled((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, true])) }))}
            onMapClick={activeTool === "draw" || activeTool === "route" ? handleMapClick : undefined}
            studioActive={activeTool === "shapes"}
            editPoints={editPoints}
            onEditPoint={moveEditPoint}
            drawMode={activeTool === "draw" ? drawMode : null}
            drawPoints={drawPoints}
            routeLine={activeTool === "route" ? routeLineForFlatMap : undefined}
            routeStyle={routeStyle}
            savedShapes={savedShapes}
            savedRoutes={savedRoutes}
            fireCollection={fireOn && (!fireOnlyUnusual || fireRangeMode !== "day" || (fireDate !== null && fireUnusual.has(fireDate))) ? fireData.collection : null}
            fireCells={fireData.cells}
            fireUnusual={fireUnusual}
            fireDate={fireOn ? fireDate : null}
            incidentsOn={enabled["my-incidents"]}
            incidentRows={incidentRowsForFlatMap}
            incidentViewMode={incidentViewMode}
            incidentBubbles={incidentBubbles}
            incidentIconMode={incidentIconMode}
            incidentHeatmapStyle={incidentHeatmapStyle}
            incidentAnnotations={incidentAnnotations}
            onUpdateIncidentAnnotation={updateIncidentAnnotation}
            hiddenIncidents={hiddenIncidents}
            onIncidentDeleted={handleIncidentDeleted}
          />
          )}
        </div>

        {mapMode === "3d" && <EditablePoints3D map={globeMap} items={editPoints} onMove={moveEditPoint} />}
        {globeWeather && <GlobeWeather map={globeMap} kind={globeWeather} visible={mapMode === "3d"} onClose={() => setGlobeWeather(null)} />}
        {mapMode === "3d" && <Studio3D map={globeMap} shapes={savedShapes} active={activeTool === "shapes"} />}

        {mapMode === "3d" && (
          <Map3DDetailPanel feature={map3DSelectedFeature} onClose={() => setMap3DSelectedFeature(null)} />
        )}

        {selectedAircraft && (
          <FlightCard
            selected={selectedAircraft}
            onClose={() => { setSelectedAircraft(null); setFollowAircraft(false); }}
            hours={trackHours}
            onHours={setTrackHours}
            follow={followAircraft}
            onFollow={setFollowAircraft}
            track={aircraftTrack}
            trackError={aircraftTrackError}
            bottom={showFirePanel && fireOn && fireHistory && fireHistory.days.length > 0 ? 150 : 16}
          />
        )}

        {showFirePanel && fireOn && fireHistory && fireHistory.days.length > 0 && (
          <FireTimeline
            days={fireHistory.days}
            coveredFrom={fireHistory.coveredFrom}
            lastCollectedAt={fireHistory.lastCollectedAt}
            lastRun={fireHistory.lastRun ?? null}
            selected={fireDate}
            unusual={fireUnusual}
            onSelect={selectFireDay}
            playing={firePlaying}
            onPlayingChange={setFirePlaying}
            right={130}
            left={enabled["active-conflicts"] ? 130 : 12}
            rangeMode={fireRangeMode}
            onRangeModeChange={setRangeMode}
            onlyUnusual={fireOnlyUnusual}
            onOnlyUnusualChange={setFireOnlyUnusual}
          />
        )}
        {enabled["active-conflicts"] && (
          <>
            <button
              onClick={() => setConflictKeyOpen((v) => !v)}
              aria-expanded={conflictKeyOpen}
              style={{ position: "absolute", left: 12, bottom: 8, zIndex: 500, padding: "4px 9px", borderRadius: 6, background: "rgba(8, 14, 24, 0.82)", border: "1px solid rgba(255,255,255,0.12)", color: "#e6edf7", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}
            >
              {conflictKeyOpen ? "Hide key" : "Key"}
            </button>
            {conflictKeyOpen && <ConflictIntensityLegend activeCount={activeRows.length} activeConfigured={activeConfigured} />}
          </>
        )}

        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 500, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, maxHeight: "calc(100% - 24px)" }}>
          <PanelToggle side="left" open={leftOpen} onClick={() => togglePanel("left")} />
          {leftOpen && (
            <>
              <LayerPanel
                defs={LAYER_DEFS}
                enabled={enabled}
                layers={layers}
                onToggle={(key) => setEnabled((prev) => ({ ...prev, [key]: !prev[key] }))}
                onToggleGroup={(group, nextOn) =>
                  setEnabled((prev) => {
                    const next = { ...prev };
                    for (const def of LAYER_DEFS) if (def.group === group) next[def.key] = nextOn;
                    return next;
                  })
                }
                maritimeLinesOn={enabled["maritime-lines"]}
                maritimeLinesCount={maritimeLanes.length}
                onToggleMaritimeLines={() => setEnabled((prev) => ({ ...prev, "maritime-lines": !prev["maritime-lines"] }))}
                submarineCablesOn={enabled["submarine-cables"]}
                submarineCablesCount={submarineCables.length}
                onToggleSubmarineCables={() => setEnabled((prev) => ({ ...prev, "submarine-cables": !prev["submarine-cables"] }))}
                listeningQueries={savedListeningQueries}
                activeListeningIds={activeListeningIds}
                listeningLiveData={listeningLiveData}
                listeningLiveErrors={listeningLiveErrors}
                listeningLiveLoading={listeningLiveLoading}
                onToggleListening={(id) => {
                  const turningOn = !activeListeningIds.has(id);
                  setActiveListeningIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                  // Turning on fetches once immediately (so the toggle isn't just
                  // a blank "…" until someone remembers to hit refresh) — but
                  // does NOT start a recurring poll; see pollListeningQuery's own
                  // comment for why that's now a manual, explicit action.
                  if (turningOn) {
                    const sq = savedListeningQueries.find((q) => q.id === id);
                    if (sq) pollListeningQuery(sq);
                  }
                }}
                onRefreshListening={refreshListeningById}
                onOpenListeningDashboard={() => {
                  setActiveTool("listen");
                  setListenTab("dashboard");
                }}
                show3DDisplayGroup={mapMode === "3d"}
                dayNight={showDayNight}
                buildings={showBuildings}
                terrain={showTerrain}
                onToggleDayNight={() => setShowDayNight((v) => !v)}
                onToggleBuildings={() => setShowBuildings((v) => !v)}
                onToggleTerrain={() => setShowTerrain((v) => !v)}
                nav={showNav}
                firePanel={showFirePanel}
                mapMode={mapMode}
                onMapMode={setMapMode}
                basemap={basemap}
                onBasemap={setBasemap}
                onSaveImage={saveMapImage}
                weather={globeWeather}
                onWeather={(w) => {
                  setGlobeWeather(w);
                  if (w) setMapMode("3d");
                }}
                labelLang={labelLang}
                onLabelLang={setLabelLang}
                onToggleNav={() => setShowNav((v) => !v)}
                onToggleFirePanel={() => {
                  // The timeline needs the fire layer, so turning the panel on turns the layer on too.
                  if (!showFirePanel) setEnabled((prev) => ({ ...prev, "firms-fires": true }));
                  setShowFirePanel((v) => !v);
                }}
              />
            </>
          )}
        </div>
        <StatusBar totalFeatures={points.length + monitorLayerPoints.length} clock={clock} />
        <GlobalStatusTicker />

        <div style={{ position: "absolute", top: 12, right: 12, zIndex: 500, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <PanelToggle side="right" open={rightOpen} onClick={() => togglePanel("right")} />
          {rightOpen && (
            <RightToolRail hide={canAfrIntel ? [] : ["afrintel"]}
              active={activeTool}
              onSelect={(tool) =>
                setActiveTool((prev) => {
                  const next = prev === tool ? null : tool;
                  // Leaving a tool clears its in-progress state, rather than
                  // leaving a half-drawn shape or a stale route sitting on the
                  // map invisibly (its panel gone, but its data/click-handling
                  // still live) the next time some other tool is opened.
                  if (next !== "draw") {
                    setDrawMode(null);
                    setDrawPoints([]);
                  }
                  if (next !== "route") {
                    setRouteOrigin(null);
                    setRouteDestination(null);
                    setRouteResult(null);
                    setRouteError(null);
                  }
                  if (next !== "shapes") studio.set({ tool: "select", selectedId: null });
                  return next;
                })
              }
            />
          )}
        </div>

        {rightTool === "monitor" && (
          <MonitoringToolPanel
            queries={queries}
            activeIds={activeMonitorIds}
            layers={monitorLayers}
            onToggleLayer={toggleMonitorLayer}
            onOpen={onOpenQuery}
            onEdit={onEditQuery}
            onNew={onNewQuery}
            onSetActive={(q, isActive) => api.updateQuery(q.id, { is_active: isActive }).then(onQueriesChanged).catch(() => {})}
            onDelete={(q) => {
              if (!window.confirm(`Delete the monitoring query "${q.name}"? Its dashboard and alerts go with it.`)) return;
              api
                .deleteQuery(q.id)
                .then(() => {
                  if (activeMonitorIds.has(q.id)) toggleMonitorLayer(q.id);
                  onQueriesChanged();
                })
                .catch(() => {});
            }}
          />
        )}
        {rightTool === "draw" && (
          <DrawingToolPanel
            mode={drawMode}
            points={drawPoints}
            onSetMode={(m) => {
              setDrawMode(m);
              setDrawPoints([]);
            }}
            onClear={() => setDrawPoints([])}
            onExport={() => downloadDrawingAsGeoJson(drawPoints, drawMode)}
            onSaveLayer={saveDrawingAsLayer}
          />
        )}
        {rightTool === "route" && (
          <RoutePlannerPanel
            mode={routeMode}
            onModeChange={setRouteMode}
            origin={routeOrigin}
            destination={routeDestination}
            result={routeResult}
            loading={routeLoading}
            error={routeError}
            onClear={() => {
              setRouteOrigin(null);
              setRouteDestination(null);
              setRouteResult(null);
              setRouteError(null);
            }}
            savedRoutes={savedRoutes}
            routeNameDraft={routeNameDraft}
            onRouteNameDraftChange={setRouteNameDraft}
            routeSaving={routeSaving}
            onSaveRoute={handleSaveRoute}
            onToggleRoute={(id, visible) => api.updateMapRoute(id, { visible }).then(refreshRoutes).catch(() => {})}
            onDeleteRoute={(id) => api.deleteMapRoute(id).then(refreshRoutes).catch(() => {})}
            onRecolourRoute={(id, color) => api.updateMapRoute(id, { color }).then(refreshRoutes).catch(() => {})}
            routeStyle={routeStyle}
            onRouteStyle={(p) => setRouteStyle((prev) => ({ ...prev, ...p }))}
            onSaveRouteAsLayer={saveRouteAsLayer}
            nearby={{ incidents: myIncidentRows, state: nearby, viewMode: incidentViewMode, onResults: applyNearby, onViewMode: showNearbyAs }}
            routeFeature={routeFeature}
            onRouteBand={(km) => routeFeature && void bufferFeature(routeFeature, km, `${routeNameDraft.trim() || "Route"}: ${km} km band`)}
          />
        )}
        {rightTool === "space" && <LiveSpacePanel pos={issPos} error={issError} />}
        {rightTool === "news" && (
          <ToolPanelShell title="Alerts">
            <LiveAlertsPanel
              onLocate={(lat, lng, zoom = 6) => setFocus((f) => ({ lat, lng, zoom, seq: (f?.seq ?? 0) + 1 }))}
              pinsOn={!!enabled["osint-alerts"]}
              onTogglePins={(on) => setEnabled((prev) => ({ ...prev, "osint-alerts": on }))}
              warningsOn={!!enabled["watch-zones"]}
              onToggleWarnings={(on) => setEnabled((prev) => ({ ...prev, "watch-zones": on }))}
            />
          </ToolPanelShell>
        )}
        {rightTool === "events" && (
          <ToolPanelShell title="Events">
            <SituationPanel />
          </ToolPanelShell>
        )}
        {rightTool === "analyses" && <StrategicAnalysesPanel isAdmin={isAdmin} onClose={() => setActiveTool((prev) => (prev === "analyses" ? null : prev))} />}
        {rightTool === "afrintel" && canAfrIntel && (
          <ToolPanelShell title="AfrIntel">
            <AfrIntelPanel
              layers={afrIntelLayerCatalog}
              onFly={(lat, lng, zoom) => setFocus((f) => ({ lat, lng, zoom, seq: (f?.seq ?? 0) + 1 }))}
              onLayers={(on, off) => setEnabled((prev) => ({ ...prev, ...Object.fromEntries(on.map((k) => [k, true])), ...Object.fromEntries(off.map((k) => [k, false])) }))}
              onPanel={(panel) => setActiveTool(panel as Exclude<RightTool, null>)}
              onMarks={setAfrIntelMarks}
              onRun={setAfrIntelRun}
            />
          </ToolPanelShell>
        )}
        {rightTool === "telegram" && (
          <ToolPanelShell title="Telegram">
            <TelegramPanel />
          </ToolPanelShell>
        )}
        {rightTool === "incidents" && (
          <IncidentsToolPanel
            filterOptions={incidentFilterOptions}
            draft={incidentFilterDraft}
            onDraftChange={setIncidentFilterDraft}
            appliedCount={Object.values(incidentFilters).filter(Boolean).length}
            resultCount={incidentSearchResults?.length ?? null}
            loading={incidentSearchLoading}
            loadAll={loadAllIncidents}
            onLoadAll={setLoadAllIncidents}
            loadedCount={myIncidentRows.length}
            onSearch={handleIncidentSearch}
            onClear={handleIncidentClearFilters}
            onAdd={() => setIncidentModalTab("add")}
            onBulkUpload={() => setIncidentModalTab("bulk")}
            onDailyReview={() => setIncidentModalTab("review")}
            onBulkDelete={handleBulkDeleteFilteredIncidents}
            bulkDeleting={incidentBulkDeleting}
            onExport={handleIncidentExport}
            exporting={incidentExporting}
            viewMode={incidentViewMode}
            onViewModeChange={setIncidentViewMode}
            bubbles={incidentBubbles}
            onBubbles={setIncidentBubbles}
            iconMode={incidentIconMode}
            onIconModeChange={setIncidentIconMode}
            heatmapStyle={incidentHeatmapStyle}
            onHeatmapStyleChange={setIncidentHeatmapStyle}
          />
        )}
        {rightTool === "economy" && (
          <ToolPanelShell title="Economy" width={PANEL_WIDE}>
            <EconomyPanel data={econData} loading={econLoading} error={econError} />
          </ToolPanelShell>
        )}
        {rightTool === "markets" && (
          <ToolPanelShell title="Markets">
            <MarketsPanel />
          </ToolPanelShell>
        )}
        {rightTool === "listen" && (
          <SocialListeningPanel
            tab={listenTab}
            onTabChange={setListenTab}
            query={listenQuery}
            onQueryChange={setListenQuery}
            onSearch={() => runSocialListening(listenQuery)}
            result={listenResult}
            loading={listenLoading}
            error={listenError}
            saveName={listenSaveName}
            onSaveNameChange={setListenSaveName}
            onSaveQuery={handleSaveListeningQuery}
            saving={listenSaving}
            savedQueries={savedListeningQueries}
            onRunSaved={(q) => {
              setListenQuery(q.query);
              setListenTab("search");
              runSocialListening(q.query);
            }}
            onTogglePinned={(q) => api.updateListeningQuery(q.id, { pinned: !q.pinned }).then(refreshListeningQueries).catch(() => {})}
            onDeleteSaved={(id) =>
              api
                .deleteListeningQuery(id)
                .then(() => {
                  setActiveListeningIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                  refreshListeningQueries();
                })
                .catch(() => {})
            }
            liveData={listeningLiveData}
            liveErrors={listeningLiveErrors}
            liveLoading={listeningLiveLoading}
            onRefreshSaved={refreshListeningById}
          />
        )}
        {rightTool === "crypto" && (
          <CryptoToolPanel
            address={cryptoAddress}
            onAddressChange={setCryptoAddress}
            chain={cryptoChain}
            onChainChange={setCryptoChain}
            onLookup={runCryptoLookup}
            result={cryptoResult}
            loading={cryptoLoading}
            error={cryptoError}
          />
        )}
        {rightTool === "shapes" && (
          <StudioPanel
            shapes={savedShapes}
            nearby={{ incidents: myIncidentRows, state: nearby, viewMode: incidentViewMode, onResults: applyNearby, onViewMode: showNearbyAs }}
          />
        )}
      </div>

      {incidentModalTab && (
        <IncidentIntakeModal
          tab={incidentModalTab}
          onTabChange={setIncidentModalTab}
          onClose={() => setIncidentModalTab(null)}
          onSaved={refreshMyIncidents}
        />
      )}
    </div>
  );
}

/** The flat-projection modes (2D / Map / Sat) reuse the same Leaflet stack
 *  already powering IncidentsMap/IncidentSearch elsewhere in this app,
 *  rather than trying to make three-globe fake a flat view — it's a real
 *  2D map, not a globe photographed from directly above. "2D" and "Map"
 *  both use street-style tiles (2D dark, Map light) — Sat uses satellite
 *  imagery, matching what the three style buttons mean on the reference platform itself. */
function FlatMap({
  basemap,
  onReady,
  points,
  sharedPaths,
  territoryChanges,
  activeConflictMap,
  conflictWaveRows,
  incidentPulses,
  aircraftTrack,
  rainOn,
  cloudsOn,
  focus,
  showNav,
  followAircraft,
  onAircraftClick,
  selectedAircraftId,
  onLayersOn,
  onMapClick,
  drawMode,
  drawPoints,
  routeLine,
  routeStyle,
  savedShapes,
  savedRoutes,
  studioActive,
  editPoints,
  onEditPoint,
  fireCollection,
  fireCells,
  fireUnusual,
  fireDate,
  incidentsOn,
  incidentRows,
  incidentViewMode,
  incidentBubbles,
  incidentIconMode,
  incidentHeatmapStyle,
  incidentAnnotations,
  onUpdateIncidentAnnotation,
  hiddenIncidents,
  onIncidentDeleted,
}: {
  basemap: BasemapId;
  /** Hands out the Leaflet map, so the view can be carried across when switching to the 3D globe. */
  onReady?: (map: LeafletMap) => void;
  points: GlobePoint[];
  /** Lanes, cables and AfrIntel links: drawn as on the 3D globe. */
  sharedPaths?: Map3DPath[];
  /** Reported territory changes: dashed amber areas, as on the 3D globe. */
  territoryChanges?: Map3DTerritoryChange[];
  /** Active conflict countries with no alert, drawn above the alert shading. */
  activeConflictMap?: FeatureCollection | null;
  /** Rings at escalations getting worse. */
  conflictWaveRows?: ConflictWave[];
  /** Surges of incidents and single serious incidents, drawn as pulsing rings. */
  incidentPulses?: IncidentPulse[];
  /** Show the zoom and pan buttons. */
  showNav?: boolean;
  /** RainViewer rain radar and infrared clouds. */
  rainOn?: boolean;
  cloudsOn?: boolean;
  /** A place to fly to (from Live Alerts); a new seq is a new request. */
  focus?: { lat: number; lng: number; zoom: number; seq: number } | null;
  /** The traced aircraft's positions, oldest first; drawn as a line. */
  aircraftTrack?: LatLng[];
  /** Keep the map centred on the traced aircraft's latest position. */
  followAircraft?: boolean;
  /** An aircraft marker was clicked: trace it. */
  onAircraftClick?: (hex: string, label: string) => void;
  /** The traced aircraft, drawn highlighted. */
  selectedAircraftId?: string | null;
  /** Switches map layers on, for region presets such as the Red Sea view. */
  onLayersOn?: (keys: string[]) => void;
  /** Set only while Drawing Tools, Route, or Shapes is the active
   *  right-side tool — its presence is literally what makes a map click do
   *  something. */
  onMapClick?: (lat: number, lng: number) => void;
  drawMode?: DrawMode;
  drawPoints?: LatLng[];
  routeLine?: LatLng[];
  routeStyle?: RouteStyle;
  /** Persisted overlays (map_shapes/map_routes) — shown regardless of which
   *  right-side tool is open, same as the live data layers, so a saved AOI
   *  or route stays visible while browsing rather than only while its own
   *  tool panel happens to be open. */
  savedShapes?: SavedShape[];
  savedRoutes?: SavedRoute[];
  /** True while the Map Studio tool is open: its shapes become clickable and its drawing tools run. */
  studioActive?: boolean;
  /** Draggable handles for Drawing Tools points and a route's ends. */
  editPoints?: EditPoint[];
  onEditPoint?: (id: string, lat: number, lng: number) => void;
  /** "My Incidents", rendered rich (bullet icons, editable/pinnable popups,
   *  adjustable heatmap) instead of as generic GlobePoint dots — see the
   *  flatMapPoints/incidentRowsForFlatMap comments at the call site. */
  /** The selected fire day's detections (satellite layer), drawn as heat or framed points. */
  fireCollection?: LiveLayerCollection | null;
  /** True when fireCollection is ~5 km cells (the range view) rather than single detections. */
  fireCells?: boolean;
  /** Fire days flagged as unusual, with their typical count. */
  fireUnusual?: Map<string, number>;
  /** The day selected on the fire timeline, which imagery follows unless a day is chosen. */
  fireDate?: string | null;
  incidentsOn?: boolean;
  incidentRows?: IncidentItem[];
  incidentViewMode?: "markers" | "heatmap";
  incidentBubbles?: boolean;
  incidentIconMode?: "actor" | "tactic";
  incidentHeatmapStyle?: HeatmapStyle;
  incidentAnnotations?: Record<string, PopupAnnotation>;
  onUpdateIncidentAnnotation?: (incidentId: string, patch: Partial<PopupAnnotation>) => void;
  hiddenIncidents?: HiddenIncidents;
  onIncidentDeleted?: (incidentId: string) => void;
}) {
  const hiddenIds = hiddenIncidents?.hiddenIds;
  const visibleIncidentRows = useMemo(
    () => (incidentRows && hiddenIds?.size ? incidentRows.filter((i) => !hiddenIds.has(i.id)) : incidentRows),
    [incidentRows, hiddenIds]
  );
  const visibleIncidentHeatPoints = useMemo(
    () => incidentHeatPoints(visibleIncidentRows ?? [], incidentHeatmapStyle ?? DEFAULT_HEATMAP_STYLE),
    [visibleIncidentRows, incidentHeatmapStyle]
  );
  const [imagery, setImagery] = useState<ImageryState>(() => {
    // A shared link can name the imagery layer and its day.
    const linked = readViewParams();
    const key = IMAGERY_KEYS.includes(linked.layer as ImageryKey) ? (linked.layer as ImageryKey) : "none";
    return { ...DEFAULT_IMAGERY, key, day: key !== "none" ? linked.date : null };
  });
  const [connectivityOn, setConnectivityOn] = useState(false);
  const [pulsesOn, setPulsesOn] = useState(true);
  const weather = useRainViewer(!!(rainOn || cloudsOn));
  const connectivity = useConnectivity(connectivityOn);
  const [regionView, setRegionView] = useState<RegionView | null>(null);
  const [regionSeq, setRegionSeq] = useState(0);
  const [outlines, setOutlines] = useState(false);
  const [waves, setWaves] = useState(true);
  const hotCells = useMemo(
    () => (waves && fireCollection ? hotCellsFrom(fireCollection.features, !!fireCells, 5, 40) : []),
    [waves, fireCollection, fireCells]
  );
  // The chosen basemap (the same one the 3D globe shows): MapTiler's with the key, the free ones otherwise.
  useMapTilerKey();
  const tile = liveBasemap(basemap);
  const imageryDay = clampImageryDay(imagery.day ?? fireDate);
  const overlay = imageryTemplate(imagery.key, imageryDay);
  const lensTemplate = overlay && imagery.lensKm !== null ? imageryTemplate(imagery.key, compareDay(imagery.compare, imageryDay, imagery.compareChosen)) : null;
  const measuredLine = drawMode === "distance" && drawPoints && drawPoints.length >= 2 ? drawPoints.map((p) => ({ lat: p[0], lng: p[1] })) : null;
  return (
    <>
    <MapContainer center={[15, 20]} zoom={2} minZoom={2} worldCopyJump zoomControl={false} style={{ height: "100%", width: "100%", background: "#000308" }}>
      {showNav && <MapNavPad />}
      <MapCompass />
      <TileLayer key={tile.leafletUrl} url={tile.leafletUrl} attribution={tile.attribution} {...tileOptions(tile.leafletUrl)} />
      {onReady && <FlatMapReady onReady={onReady} />}
      <RegionFly region={regionView} seq={regionSeq} />
      <ViewPermalink date={imagery.key !== "none" ? imageryDay : fireDate ?? null} layer={imagery.key} />
      <MapSearchPanel>
        {measuredLine && <TerrainProfile path={measuredLine} />}
        <SunShadowTool defaultDay={imageryDay} />
        {connectivityOn && <ConnectivityPanel data={connectivity.data} error={connectivity.error} />}
        <FireDownload collection={fireCollection ?? null} label={fireDate ?? "latest"} />
      </MapSearchPanel>
      {connectivityOn && connectivity.data && <ConnectivityLayer data={connectivity.data} />}
      {lensTemplate && imagery.lensKm !== null && <BeforeAfterLens template={lensTemplate} radiusKm={imagery.lensKm} />}
      {outlines && <HornOutlines />}
      {hotCells.length > 0 && <HotspotWaves cells={hotCells} />}
      {weather.frames && (rainOn || cloudsOn) && <WeatherTiles frames={weather.frames} rain={!!rainOn} clouds={!!cloudsOn} />}
      {overlay && <TileLayer key={overlay.url} url={overlay.url} attribution={overlay.attribution} maxNativeZoom={overlay.maxNativeZoom} opacity={0.9} zIndex={5} />}
      {activeConflictMap && (
        <GeoJSON
          key={countryShadingKey(activeConflictMap)}
          data={activeConflictMap}
          style={(f) => countryPathStyle(((f?.properties as { intensity?: number })?.intensity ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8)}
          onEachFeature={(f, layer) => layer.bindTooltip(String((f.properties as { label?: string }).label ?? ""), { sticky: true })}
        />
      )}
      {(conflictWaveRows ?? []).map((w) => (
        <Marker
          key={w.id}
          position={[w.lat, w.lon]}
          interactive={false}
          icon={divIcon({
            className: "conflict-wave-icon",
            iconSize: [0, 0],
            html: `<span class="conflict-wave conflict-wave--${w.level}"></span><span class="conflict-wave conflict-wave--${w.level} conflict-wave--late"></span>`,
          })}
        />
      ))}
      {pulsesOn && incidentPulses && incidentPulses.length > 0 && <IncidentPulseLayer pulses={incidentPulses} />}
      {(territoryChanges ?? []).map((t) => (
        <Polygon key={t.id} positions={t.ring} pathOptions={{ color: "#ff9d4f", weight: 1.5, opacity: 0.75, dashArray: "4 4", fillColor: "#ff9d4f", fillOpacity: 0.12 }}>
          <LeafletTooltip sticky>{t.title}</LeafletTooltip>
        </Polygon>
      ))}
      {(sharedPaths ?? []).map((p, i) => (
        <Polyline key={`${p.label}-${i}`} positions={p.points} pathOptions={{ color: p.color ?? "#3fd0ff", weight: p.width ?? 2, opacity: 0.9 }}>
          <LeafletTooltip sticky>{p.label}</LeafletTooltip>
        </Polyline>
      ))}
      {onMapClick && <MapClickCapture onClick={onMapClick} />}
      {drawMode === "distance" && drawPoints && drawPoints.length >= 2 && (
        <Polyline positions={drawPoints} pathOptions={{ color: "#ffd23f", weight: 2 }} />
      )}
      {drawMode === "area" && drawPoints && drawPoints.length >= 3 && (
        <Polygon positions={drawPoints} pathOptions={{ color: "#ffd23f", fillColor: "#ffd23f", fillOpacity: 0.25, weight: 2 }} />
      )}
      {routeLine && routeLine.length >= 2 && (
        <>
          {(routeStyle?.glow ?? true) && <Polyline positions={routeLine} pathOptions={{ color: routeStyle?.color ?? "#4dff9e", weight: (routeStyle?.weight ?? 5) + 8, opacity: 0.22, lineCap: "round" }} interactive={false} />}
          <Polyline positions={routeLine} pathOptions={{ color: routeStyle?.color ?? "#4dff9e", weight: routeStyle?.weight ?? 5, opacity: routeStyle?.opacity ?? 0.95, dashArray: routeStyle?.dash ?? undefined, lineCap: "round", lineJoin: "round" }} />
        </>
      )}
      <StudioLayer shapes={savedShapes ?? []} active={!!studioActive} />
      {editPoints && onEditPoint && <EditablePoints items={editPoints} onMove={onEditPoint} />}
      {savedRoutes
        ?.filter((r) => r.visible)
        .map((r) => (
          <Polyline key={r.id} positions={r.geometry as LatLng[]} pathOptions={{ color: r.color || "#4dff9e", weight: 3 }}>
            <LeafletTooltip direction="center">{r.name}</LeafletTooltip>
          </Polyline>
        ))}
      <AircraftMarkers points={points.filter((p) => AIRCRAFT_LAYER_KEYS.has(p.layerKey))} selectedId={selectedAircraftId ?? null} onSelect={(id, title) => onAircraftClick?.(id, title)} />
      {points.filter((p) => !AIRCRAFT_LAYER_KEYS.has(p.layerKey)).map((p) =>
        p.escalationLevel && p.incident ? (
          <EscalationFlatMarker key={`${p.layerKey}:${p.id}`} lat={p.lat} lng={p.lng} level={p.escalationLevel} incident={p.incident} />
        ) : p.escalationLevel ? (
          // An escalation without its incident record: the same triangle, opening Liveuamap's map of the country.
          <Marker
            key={`${p.layerKey}:${p.id}`}
            position={[p.lat, p.lng]}
            icon={warningMarkerIcon(p.escalationLevel)}
            eventHandlers={{ click: () => openLiveuamap(liveuamapLink(p.countryCode, p.lat, p.lng, undefined)) }}
          >
            <LeafletTooltip direction="top">
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                <b>{p.title}</b>
                <br />
                {p.subtitle}
              </div>
            </LeafletTooltip>
          </Marker>
        ) : (
        <CircleMarker
          key={`${p.layerKey}:${p.id}`}
          center={[p.lat, p.lng]}
          // The same dot as on the 3D globe (mapSymbols.ts).
          radius={dotRadius(p.size)}
          pathOptions={{ color: DOT.stroke, fillColor: p.color, fillOpacity: DOT.fillOpacity, weight: DOT.strokeWidth }}
        >
          <LeafletTooltip direction="top">
            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
              <b>{p.title}</b>
              <br />
              <span style={{ opacity: 0.7 }}>{p.layerKey}</span>
              <br />
              {p.subtitle}
            </div>
          </LeafletTooltip>
        </CircleMarker>
        )
      )}
      {aircraftTrack && aircraftTrack.length >= 2 && (
        <>
          <Polyline positions={aircraftTrack} pathOptions={{ color: "#ffd23f", weight: 3, opacity: 0.9 }} />
          <CircleMarker center={aircraftTrack[0]} radius={5} pathOptions={{ color: "#ffd23f", fillColor: "#0b1220", fillOpacity: 1, weight: 2 }}>
            <LeafletTooltip direction="top">First stored position</LeafletTooltip>
          </CircleMarker>
        </>
      )}
      {followAircraft && aircraftTrack && aircraftTrack.length > 0 && <FollowPoint at={aircraftTrack[aircraftTrack.length - 1]} />}
      {focus && <FlyToFocus focus={focus} />}
      {fireCollection && <FireMapLayer collection={fireCollection} unusual={fireUnusual ?? new Map()} cells={!!fireCells} />}
      {incidentsOn && visibleIncidentRows && visibleIncidentRows.length > 0 && incidentViewMode === "markers" && (() => {
        const markers = visibleIncidentRows.map((i) => (
          <IncidentMarker
            key={i.id}
            incident={i}
            highlighted
            iconMode={incidentIconMode ?? "actor"}
            annotation={incidentAnnotations?.[i.id]}
            onUpdateAnnotation={onUpdateIncidentAnnotation ?? (() => {})}
            onHide={hiddenIncidents?.hide}
            onDeleted={onIncidentDeleted}
          />
        ));
        return incidentBubbles ? <MarkerClusterGroup chunkedLoading>{markers}</MarkerClusterGroup> : <>{markers}</>;
      })()}
      {incidentsOn && visibleIncidentRows && visibleIncidentRows.length > 0 && incidentViewMode === "heatmap" && (
        <HeatmapLayer
          points={visibleIncidentHeatPoints}
          style={incidentHeatmapStyle}
        />
      )}
      {incidentsOn && incidentRows && hiddenIncidents && <HiddenIncidentsControl incidents={incidentRows} hidden={hiddenIncidents} />}
    </MapContainer>
    <div style={{ position: "absolute", top: 10, left: "var(--lens-pad-left, 10px)", zIndex: 500, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", maxWidth: "62%" }}>
    <ImageryControl value={imagery} onChange={setImagery} shownDay={imageryDay} />
    <RegionBar
      region={regionView?.key ?? null}
      onRegion={(r) => {
        setRegionView(r);
        setRegionSeq((n) => n + 1);
        if (r?.layers) onLayersOn?.(r.layers);
      }}
      outlines={outlines}
      onOutlines={setOutlines}
      waves={waves}
      onWaves={setWaves}
      connectivity={connectivityOn}
      onConnectivity={setConnectivityOn}
      pulses={pulsesOn}
      onPulses={setPulsesOn}
    />
    </div>
    </>
  );
}

/** Hands the Leaflet map out once it exists. */
function FlatMapReady({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => onReady(map), [map, onReady]);
  return null;
}

/** Zoom and pan buttons for the flat maps, bottom-right and away from the left panel. */
function MapNavPad() {
  const map = useMap();
  return <NavPad onZoomIn={() => map.zoomIn()} onZoomOut={() => map.zoomOut()} onPan={(dx, dy) => map.panBy([dx, dy])} />;
}

/** Bridges Leaflet's own click event to this view's tool click-handling —
 *  a null-rendering child rather than a prop on MapContainer itself since
 *  react-leaflet only exposes map events through hooks used from inside
 *  the map's own React context. */
function MapClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Left-side layer panel — the reference platform's own collapsed icon rail (its real left
 *  sidebar, seen icon-only) rather than the wide labeled list this view
 *  first shipped: one group per rail icon, vertically stacked in group
 *  order. Every group — even a group with only one real layer, like
 *  Maritime — renders through the same GroupRailButton: a live-count badge
 *  on the rail icon itself, and hovering opens a flyout with the group
 *  name, an enable/disable-everything button reading "ALL" or "NONE"
 *  depending on the group's own current state, a close (×), and one
 *  toggle+count row per layer, matching direct screenshots of the reference platform's own
 *  AVIATION, MARITIME and NATURAL HAZARDS flyouts down to that
 *  one-row-is-still-a-flyout detail and the state-reflecting button label.
 *  A thin gold hairline separates each group in the rail. */
function LayerPanel({
  defs,
  enabled,
  layers,
  onToggle,
  onToggleGroup,
  maritimeLinesOn,
  maritimeLinesCount,
  onToggleMaritimeLines,
  submarineCablesOn,
  submarineCablesCount,
  onToggleSubmarineCables,
  listeningQueries,
  activeListeningIds,
  listeningLiveData,
  listeningLiveErrors,
  listeningLiveLoading,
  onToggleListening,
  onRefreshListening,
  onOpenListeningDashboard,
  show3DDisplayGroup,
  nav,
  firePanel,
  mapMode,
  onMapMode,
  basemap,
  onBasemap,
  onSaveImage,
  weather,
  onWeather,
  labelLang,
  onLabelLang,
  onToggleNav,
  onToggleFirePanel,
  dayNight,
  buildings,
  terrain,
  onToggleDayNight,
  onToggleBuildings,
  onToggleTerrain,
}: {
  defs: LayerDef[];
  enabled: Record<string, boolean>;
  layers: Record<string, LayerState>;
  onToggle: (key: string) => void;
  onToggleGroup: (group: LayerGroup, nextOn: boolean) => void;
  maritimeLinesOn: boolean;
  maritimeLinesCount: number;
  onToggleMaritimeLines: () => void;
  submarineCablesOn: boolean;
  submarineCablesCount: number;
  onToggleSubmarineCables: () => void;
  listeningQueries: SavedListeningQuery[];
  activeListeningIds: Set<string>;
  listeningLiveData: Record<string, SocialListeningResult | null>;
  listeningLiveErrors: Record<string, string | null>;
  listeningLiveLoading: Record<string, boolean>;
  onToggleListening: (id: string) => void;
  onRefreshListening: (id: string) => void;
  onOpenListeningDashboard: () => void;
  /** 3D-mode-only render settings (Day/Night, 3D Buildings, 3D Terrain) —
   *  previously their own always-visible "Display" box floating separately
   *  at bottom-left; folded into this same rail as one more hover-flyout
   *  group per Simon's "collapse it into the left panel... I don't want to
   *  see it" — so nothing shows until the rail icon itself is hovered,
   *  same as every other group here. Undefined/false hides the group
   *  entirely (2D/satellite modes, where none of these three apply). */
  show3DDisplayGroup?: boolean;
  nav?: boolean;
  firePanel?: boolean;
  /** The map type (3D globe, 2D, street map, satellite), chosen from its own rail button under Display. */
  mapMode?: MapMode;
  onMapMode?: (m: MapMode) => void;
  basemap?: BasemapId;
  onBasemap?: (b: BasemapId) => void;
  onSaveImage?: () => void;
  weather?: GlobeWeatherKind | null;
  onWeather?: (w: GlobeWeatherKind | null) => void;
  labelLang?: string;
  onLabelLang?: (l: string) => void;
  onToggleNav?: () => void;
  onToggleFirePanel?: () => void;
  dayNight?: boolean;
  buildings?: boolean;
  terrain?: boolean;
  onToggleDayNight?: () => void;
  onToggleBuildings?: () => void;
  onToggleTerrain?: () => void;
}) {
  const groupedRows = useMemo(() => GROUP_ORDER.map((group) => defs.filter((d) => d.group === group)).filter((rows) => rows.length > 0), [defs]);
  const pinnedListeningQueries = useMemo(() => listeningQueries.filter((q) => q.pinned), [listeningQueries]);

  return (
    <div style={{ ...glassPanel(), position: "relative", display: "flex", flexDirection: "column", gap: 2, padding: 5 }}>
      <div style={{ borderBottom: "1px solid rgba(212,175,55,0.12)", paddingBottom: 4, marginBottom: 2 }}>
        <RailHoverToggle
          icon={Waypoints}
          label="Maritime Lines"
          on={maritimeLinesOn}
          count={maritimeLinesCount}
          onToggle={onToggleMaritimeLines}
        />
        <RailHoverToggle
          icon={Cable}
          label="Submarine Cables"
          on={submarineCablesOn}
          count={submarineCablesCount}
          onToggle={onToggleSubmarineCables}
        />
      </div>
      {groupedRows.map((rows, gi) => (
        <div
          key={rows[0].group}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            ...(gi > 0 ? { borderTop: "1px solid rgba(212,175,55,0.12)", paddingTop: 4, marginTop: 2 } : {}),
          }}
        >
          <GroupRailButton
            group={rows[0].group}
            rows={rows}
            enabled={enabled}
            layers={layers}
            onToggle={onToggle}
            onToggleAll={(nextOn) => onToggleGroup(rows[0].group, nextOn)}
          />
        </div>
      ))}
      {false && pinnedListeningQueries.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(212,175,55,0.12)", paddingTop: 4, marginTop: 2 }}>
          <ListeningRailButton
            queries={pinnedListeningQueries}
            activeIds={activeListeningIds}
            liveData={listeningLiveData}
            liveErrors={listeningLiveErrors}
            liveLoading={listeningLiveLoading}
            onToggle={onToggleListening}
            onRefresh={onRefreshListening}
            onOpenDashboard={onOpenListeningDashboard}
          />
        </div>
      )}
      {(
        <div style={{ borderTop: "1px solid rgba(212,175,55,0.12)", paddingTop: 4, marginTop: 2 }}>
          <DisplayRailGroup
            show3D={!!show3DDisplayGroup}
            nav={!!nav}
            firePanel={!!firePanel}
            onToggleNav={onToggleNav!}
            onToggleFirePanel={onToggleFirePanel!}
            dayNight={!!dayNight}
            buildings={!!buildings}
            terrain={!!terrain}
            onToggleDayNight={onToggleDayNight!}
            onToggleBuildings={onToggleBuildings!}
            onToggleTerrain={onToggleTerrain!}
          />
          {mapMode && onMapMode && basemap && onBasemap && <MapTypeRailButton mode={mapMode} onChange={onMapMode} basemap={basemap} onBasemap={onBasemap} onSaveImage={onSaveImage} weather={weather ?? null} onWeather={onWeather} labelLang={labelLang} onLabelLang={onLabelLang} />}
        </div>
      )}
    </div>
  );
}

/** Left-rail flyout for pinned Social Listening queries — same visual
 *  language as GroupRailButton (hover to open, toggle switch per row, a
 *  live count badge) but the "count" here is coverage volume for the last
 *  7 days rather than a point count, since listening results aren't
 *  geographic the way every other layer's are. Only pinned saved queries
 *  show up here — pin one from the Listen tool's Dashboard tab to add it. */
function ListeningRailButton({
  queries,
  activeIds,
  liveData,
  liveErrors,
  liveLoading,
  onToggle,
  onRefresh,
  onOpenDashboard,
}: {
  queries: SavedListeningQuery[];
  activeIds: Set<string>;
  liveData: Record<string, SocialListeningResult | null>;
  liveErrors: Record<string, string | null>;
  liveLoading: Record<string, boolean>;
  onToggle: (id: string) => void;
  onRefresh: (id: string) => void;
  onOpenDashboard: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const activeCount = queries.filter((q) => activeIds.has(q.id)).length;

  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        onClick={onOpenDashboard}
        title={`Social Listening${activeCount ? ` — ${activeCount}/${queries.length} live` : ""}`}
        style={{
          position: "relative",
          width: 42,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: activeCount > 0 ? "rgba(212,175,55,0.14)" : "transparent",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        <Megaphone size={17} color={activeCount > 0 ? HUD.cyan : HUD.textMuted} strokeWidth={activeCount > 0 ? 2.25 : 1.75} />
        {activeCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 15,
              height: 15,
              padding: "0 3px",
              borderRadius: 999,
              background: HUD.cyan,
              color: "#04121a",
              fontSize: 9,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxShadow: "0 0 6px rgba(0,229,255,0.5)",
            }}
          >
            {activeCount}
          </span>
        )}
      </button>
      {hovered && (
        <div
          style={{
            ...glassPanel(),
            position: "absolute",
            left: "100%",
            top: 0,
            width: 240,
            padding: "10px 10px 10px 18px",
            zIndex: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 }}>
              Social Listening
            </span>
            <button onClick={() => setHovered(false)} style={{ background: "transparent", border: "none", color: HUD.textMuted, cursor: "pointer", padding: 0, display: "flex" }}>
              <CloseGlyph size={13} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {queries.map((q) => {
              const isOn = activeIds.has(q.id);
              const live = liveData[q.id];
              const err = liveErrors[q.id];
              const loading = liveLoading[q.id];
              const tone = live?.latestTone ?? null;
              return (
                <div key={q.id} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                  <button
                    onClick={() => onToggle(q.id)}
                    style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", textAlign: "left" }}
                  >
                    <LayerToggleSwitch on={isOn} />
                    <span style={{ flex: 1, fontSize: 11, color: isOn ? HUD.textPrimary : HUD.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {q.name}
                    </span>
                    {isOn && err ? (
                      <span title={err} style={{ fontSize: 9, fontWeight: 700, color: HUD.alertRed, cursor: "help" }}>
                        ERR
                      </span>
                    ) : isOn && tone !== null ? (
                      <span style={{ fontSize: 10, fontWeight: 700, color: toneLabel(tone).color }}>{tone.toFixed(1)}</span>
                    ) : (
                      <span style={{ fontSize: 10, color: HUD.textMuted }}>{isOn ? "no data" : "off"}</span>
                    )}
                  </button>
                  {isOn && (
                    <button
                      onClick={() => onRefresh(q.id)}
                      disabled={loading}
                      title="Fetch latest now (manual — this doesn't auto-poll, to avoid piling onto GDELT's shared rate limit)"
                      style={{ background: "transparent", border: "none", color: loading ? HUD.textMuted : HUD.cyan, cursor: loading ? "wait" : "pointer", padding: 0, display: "flex", flexShrink: 0 }}
                    >
                      <RefreshCw size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={onOpenDashboard}
            style={{
              marginTop: 8,
              width: "100%",
              background: "transparent",
              border: "1px solid rgba(212,175,55,0.25)",
              borderRadius: 5,
              color: HUD.gold,
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "4px 0",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Open dashboard
          </button>
        </div>
      )}
    </div>
  );
}

/** A group's rail button — one icon standing in for several layers, exactly
 *  matching direct screenshots of the reference platform's own AVIATION and NATURAL
 *  HAZARDS flyouts: hovering opens a card with the group name, an
 *  enable/disable-everything button (labeled "ALL" when every row is on,
 *  "NONE" otherwise — the reference platform's own flyout showed "NONE" with all three
 *  Natural Hazards rows off), a close (×), and one row per layer (its own
 *  icon, toggle, and live count). The rail icon itself shows the group's
 *  combined live count
 *  across whichever of its layers are on, so the rail stays informative
 *  even with the flyout closed. */
function GroupRailButton({
  group,
  rows,
  enabled,
  layers,
  onToggle,
  onToggleAll,
}: {
  group: LayerGroup;
  rows: LayerDef[];
  enabled: Record<string, boolean>;
  layers: Record<string, LayerState>;
  onToggle: (key: string) => void;
  onToggleAll: (nextOn: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = GROUP_META[group];
  const GroupIcon = meta.icon;
  const activeRows = rows.filter((d) => enabled[d.key]);
  const allActive = activeRows.length === rows.length;
  const totalCount = activeRows.reduce((sum, d) => sum + (layers[d.key]?.data?.length ?? 0), 0);

  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        onClick={() => onToggleAll(!allActive)}
        title={`${group}${activeRows.length ? ` — ${activeRows.length}/${rows.length} on` : " — off"}`}
        style={{
          position: "relative",
          width: 42,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: activeRows.length > 0 ? "rgba(212,175,55,0.14)" : "transparent",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        <GroupIcon size={17} color={activeRows.length > 0 ? meta.color : HUD.textMuted} strokeWidth={activeRows.length > 0 ? 2.25 : 1.75} />
        {activeRows.length > 0 && totalCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 15,
              height: 15,
              padding: "0 3px",
              borderRadius: 999,
              background: HUD.cyan,
              color: "#04121a",
              fontSize: 9,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxShadow: "0 0 6px rgba(0,229,255,0.5)",
            }}
          >
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        )}
      </button>
      {hovered && (
        <div
          style={{
            ...glassPanel(),
            position: "absolute",
            left: "100%",
            top: 0,
            // Same fix as RailHoverToggle's flyout below: no marginLeft
            // gap between the rail icon and the flyout — that gap was a
            // dead zone with no hoverable element in it, so moving the
            // mouse toward the toggles fired onMouseLeave and closed the
            // flyout before it could be reached. The visual gap is now
            // internal padding instead, which stays part of the same
            // continuously-hoverable box as the icon button.
            width: 220,
            padding: "10px 10px 10px 18px",
            zIndex: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 }}>{group}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => onToggleAll(!allActive)}
                title={allActive ? "Turn all off" : "Turn all on"}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: 9.5, letterSpacing: "0.1em", fontWeight: 700, color: allActive ? meta.color : HUD.textMuted, fontFamily: "inherit" }}
              >
                {/* Reflects the group's own current state rather than a
                    fixed label — matches a direct screenshot of the reference platform's
                    real NATURAL HAZARDS flyout showing "NONE" while every
                    row in that group was off. */}
                {allActive ? "ALL" : "NONE"}
              </button>
              <button onClick={() => setHovered(false)} style={{ background: "transparent", border: "none", color: HUD.textMuted, cursor: "pointer", padding: 0, display: "flex" }}>
                <CloseGlyph size={13} />
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {rows.map((def) => {
              const state = layers[def.key];
              const isOn = enabled[def.key];
              const count = state?.data?.length ?? 0;
              const Icon = def.icon;
              return (
                <button
                  key={def.key}
                  onClick={() => onToggle(def.key)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", padding: "3px 0", fontFamily: "inherit", textAlign: "left" }}
                >
                  <LayerToggleSwitch on={isOn} />
                  <Icon size={13} color={isOn ? def.color : HUD.textMuted} />
                  <span style={{ flex: 1, fontSize: 11, color: isOn ? HUD.textPrimary : HUD.textSecondary }}>{def.label}</span>
                  {state?.error ? (
                    <span title={state.error} style={{ fontSize: 9, fontWeight: 700, color: HUD.alertRed, cursor: "help" }}>
                      ERR
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isOn ? def.color : HUD.textMuted }}>
                      {state?.loading ? "…" : count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** A rail button that reveals its toggle on hover instead of toggling
 *  directly on click — for a path/line layer (like the shipping-lane
 *  arcs) that doesn't carry its own per-feature entity count the way a
 *  fetched point layer does, so a bare click-to-toggle icon would give no
 *  feedback about what it even controls. Matches a direct screenshot of
 *  The reference platform's own top-of-rail "Maritime Lines" control: hovering the icon
 *  opens a small flyout to its right with the toggle switch, label and
 *  live count; a close (×) button dismisses it explicitly since the mouse
 *  has to cross into the flyout itself to reach the switch. */
function RailHoverToggle({
  icon: Icon,
  label,
  on,
  count,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  on: boolean;
  count: number;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        onClick={onToggle}
        title={`${label}${on ? ` — ${count.toLocaleString()} routes` : " — off"}`}
        style={{
          position: "relative",
          width: 42,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: on ? "rgba(212,175,55,0.14)" : "transparent",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        <Icon size={17} color={on ? HUD.cyan : HUD.textMuted} strokeWidth={on ? 2.25 : 1.75} />
        {on && count > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 15,
              height: 15,
              padding: "0 3px",
              borderRadius: 999,
              background: HUD.cyan,
              color: "#04121a",
              fontSize: 9,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxShadow: "0 0 6px rgba(0,229,255,0.5)",
            }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {hovered && (
        <div
          style={{
            ...glassPanel(),
            position: "absolute",
            left: "100%",
            top: 0,
            // No marginLeft gap: a gap here is a dead zone the mouse has
            // to cross without hovering *either* element, which fires
            // onMouseLeave on the wrapping div before the cursor ever
            // reaches the flyout — the exact bug reported live. The same
            // 8px of visual breathing room is kept via paddingLeft
            // instead, which is part of this element's own hoverable box.
            width: 190,
            padding: "10px 10px 10px 18px",
            zIndex: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: HUD.textSecondary, fontWeight: 700 }}>{label}</span>
            <button
              onClick={() => setHovered(false)}
              style={{ background: "transparent", border: "none", color: HUD.textMuted, cursor: "pointer", padding: 0, display: "flex" }}
            >
              <CloseGlyph size={13} />
            </button>
          </div>
          <button
            onClick={onToggle}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", textAlign: "left" }}
          >
            <LayerToggleSwitch on={on} />
            <span style={{ flex: 1, fontSize: 11, color: on ? HUD.textPrimary : HUD.textSecondary }}>{label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: on ? HUD.cyan : HUD.textMuted }}>{count}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The 3D view's render-setting toggles (Day/Night, 3D Buildings, 3D
 *  Terrain) — folded into the same hover-flyout rail every other layer
 *  group uses (same shape as GroupRailButton, just without per-row counts
 *  since these are view settings, not fetched data layers). Previously its
 *  own permanently-visible "Display" box floating separately at
 *  bottom-left; per Simon's "the display pop up, I don't want to see it,
 *  collapse it into the left panel", nothing shows now until this rail
 *  icon itself is hovered. */
function DisplayRailGroup({
  show3D,
  nav,
  firePanel,
  onToggleNav,
  onToggleFirePanel,
  dayNight,
  buildings,
  terrain,
  onToggleDayNight,
  onToggleBuildings,
  onToggleTerrain,
}: {
  show3D: boolean;
  nav: boolean;
  firePanel: boolean;
  onToggleNav: () => void;
  onToggleFirePanel: () => void;
  dayNight: boolean;
  buildings: boolean;
  terrain: boolean;
  onToggleDayNight: () => void;
  onToggleBuildings: () => void;
  onToggleTerrain: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const rows: { label: string; hint?: string; icon: LucideIcon; on: boolean; onToggle: () => void }[] = [
    { label: "Zoom & Pan Buttons", icon: ZoomIn, on: nav, onToggle: onToggleNav },
    { label: "Fire Timeline Panel", hint: "Turns the fire layer on too", icon: Flame, on: firePanel, onToggle: onToggleFirePanel },
    ...(show3D
      ? [
          { label: "Day / Night Cycle", icon: Sun, on: dayNight, onToggle: onToggleDayNight },
          { label: "3D Buildings", hint: "City detail — zoom 14.5+", icon: Building2, on: buildings, onToggle: onToggleBuildings },
          { label: "3D Terrain", hint: "Mountains — zoom 10+", icon: Mountain, on: terrain, onToggle: onToggleTerrain },
        ]
      : []),
  ];
  const activeCount = rows.filter((r) => r.on).length;
  const allActive = activeCount === rows.length;

  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        onClick={() => rows.forEach((r) => { if (r.on === allActive) r.onToggle(); })}
        title={`Display${activeCount ? ` — ${activeCount}/${rows.length} on` : " — off"}`}
        style={{
          position: "relative",
          width: 42,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: activeCount > 0 ? "rgba(212,175,55,0.14)" : "transparent",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        <Sun size={17} color={activeCount > 0 ? HUD.gold : HUD.textMuted} strokeWidth={activeCount > 0 ? 2.25 : 1.75} />
      </button>
      {hovered && (
        <div
          style={{
            ...glassPanel(),
            position: "absolute",
            left: "100%",
            top: 0,
            width: 220,
            padding: "10px 10px 10px 18px",
            zIndex: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 }}>Display</span>
            <button onClick={() => setHovered(false)} style={{ background: "transparent", border: "none", color: HUD.textMuted, cursor: "pointer", padding: 0, display: "flex" }}>
              <CloseGlyph size={13} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r) => (
              <button
                key={r.label}
                onClick={r.onToggle}
                style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0 }}
              >
                <r.icon size={13} color={r.on ? HUD.gold : HUD.textMuted} />
                <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <span style={{ fontSize: 11, color: r.on ? HUD.textPrimary : HUD.textSecondary }}>{r.label}</span>
                  {r.hint && <span style={{ fontSize: 9.5, color: HUD.textMuted }}>{r.hint}</span>}
                </span>
                <LayerToggleSwitch on={r.on} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The reference platform's own .layer-toggle: a 28×14 pill, gold-tinted + gold-glowing
 *  thumb when active, muted gray otherwise — ported from its exact CSS
 *  rule rather than the generic blue switch this view used before. */
function LayerToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      style={{
        position: "relative",
        width: 28,
        height: 14,
        borderRadius: 7,
        flexShrink: 0,
        background: on ? "rgba(212,175,55,0.25)" : "rgba(255,255,255,0.06)",
        border: `1px solid ${on ? HUD.gold : "rgba(255,255,255,0.08)"}`,
        transition: "all 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: on ? 15 : 1,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: on ? HUD.gold : HUD.textMuted,
          boxShadow: on ? "0 0 8px rgba(212,175,55,0.5)" : "none",
          transition: "all 0.2s",
        }}
      />
    </span>
  );
}

/** The small button that shows or hides the left layer panel or the right tool rail. */
function PanelToggle({ side, open, onClick }: { side: "left" | "right"; open: boolean; onClick: () => void }) {
  const Icon = side === "left" ? (open ? PanelLeftClose : PanelLeftOpen) : open ? PanelRightClose : PanelRightOpen;
  const label = side === "left" ? "Layers and map type" : "Tools";
  return (
    <button
      onClick={onClick}
      title={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`}
      aria-pressed={open}
      style={{ ...glassPanel({ borderRadius: 10 }), display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", color: open ? HUD.gold : HUD.textMuted, cursor: "pointer", fontFamily: "inherit", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

/** Left-rail button under Display for the map type. Clicking opens a picker beside the rail: the view (3D globe or
 *  flat map) and the basemap (any of liveBasemaps(), in either view). Clicking elsewhere closes it. */
const VIEWS: { key: MapMode; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "3d", label: "3D Globe", hint: "Globe, terrain, buildings, day/night", icon: Globe },
  { key: "2d", label: "Flat map", hint: "Imagery comparison, regions, analysis tools", icon: Square },
];
const BASEMAP_ICON: Record<BasemapId, LucideIcon> = {
  dark: Square,
  streets: MapIcon,
  "satellite-labels": Satellite,
  satellite: Satellite,
  outdoor: Mountain,
  topo: Mountain,
  "data-dark": Layers,
  "data-light": Layers,
  toner: Layers,
};
const LABEL_LANGS: { key: string; label: string }[] = [
  { key: "en", label: "English" },
  { key: "fr", label: "French" },
  { key: "ar", label: "Arabic" },
  { key: "pt", label: "Portuguese" },
  { key: "sw", label: "Swahili" },
  { key: "am", label: "Amharic" },
  { key: "name", label: "Local names" },
];
function MapTypeRailButton({ mode, onChange, basemap, onBasemap, onSaveImage, weather, onWeather, labelLang, onLabelLang }: { mode: MapMode; onChange: (m: MapMode) => void; basemap: BasemapId; onBasemap: (b: BasemapId) => void; onSaveImage?: () => void; weather: GlobeWeatherKind | null; onWeather?: (w: GlobeWeatherKind | null) => void; labelLang?: string; onLabelLang?: (l: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { key: mtKey } = useMapTilerKey();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const view = VIEWS.find((t) => t.key === mode) ?? VIEWS[0];
  const bases = liveBasemaps();
  const base = bases.find((b) => b.id === basemap) ?? bases[0];
  const Icon = mode === "3d" ? Globe : BASEMAP_ICON[base.id];
  const row = (on: boolean, icon: LucideIcon, label: string, hint: string, onClick: () => void, key: string) => {
    const I = icon;
    return (
      <button
        key={key}
        onClick={onClick}
        aria-pressed={on}
        style={{ display: "flex", alignItems: "center", gap: 8, background: on ? "rgba(212,175,55,0.14)" : "transparent", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: "5px 6px" }}
      >
        <I size={14} color={on ? HUD.gold : HUD.textMuted} />
        <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <span style={{ fontSize: 11, color: on ? HUD.gold : HUD.textPrimary, fontWeight: on ? 700 : 500 }}>{label}</span>
          <span style={{ fontSize: 9.5, color: HUD.textMuted }}>{hint}</span>
        </span>
      </button>
    );
  };
  const heading = (t: string) => <div style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700, margin: "2px 0 6px" }}>{t}</div>;
  return (
    <div ref={ref} style={{ position: "relative", marginTop: 2 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Map: ${view.label}, ${base.label}`}
        aria-expanded={open}
        style={{ position: "relative", width: 42, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: open ? "rgba(212,175,55,0.14)" : "transparent", border: "none", borderRadius: 8, cursor: "pointer", transition: "background 0.15s" }}
      >
        <Icon size={17} color={open ? HUD.gold : HUD.textSecondary} strokeWidth={open ? 2.25 : 1.75} />
        <span style={{ position: "absolute", bottom: 2, right: 3, fontSize: 7.5, fontWeight: 800, letterSpacing: "0.04em", color: HUD.gold }}>{mode === "3d" ? "3D" : "2D"}</span>
      </button>
      {open && (
        <div style={{ ...glassPanel(), position: "absolute", left: "100%", bottom: 0, width: 230, maxHeight: "70vh", overflowY: "auto", padding: "10px 10px 10px 18px", zIndex: 600 }}>
          {heading("View")}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>{VIEWS.map((t) => row(t.key === mode, t.icon, t.label, t.hint, () => onChange(t.key), t.key))}</div>
          {heading("Basemap")}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {bases.map((b) =>
              row(b.id === base.id, BASEMAP_ICON[b.id], b.label, b.hint, () => {
                onBasemap(b.id);
                setOpen(false);
              }, b.id)
            )}
          </div>
          {mtKey && onWeather && (
            <div style={{ marginTop: 10 }}>
              {heading("Weather · 3D globe")}
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {row(weather === null, X, "None", "No weather layer", () => onWeather(null), "wx-none")}
                {GLOBE_WEATHER.map((w) =>
                  row(weather === w.key, w.key === "wind" ? Wind : w.key === "temperature" ? Thermometer : CloudRain, w.label, w.hint, () => {
                    onWeather(w.key);
                    setOpen(false);
                  }, `wx-${w.key}`)
                )}
              </div>
            </div>
          )}
          {mtKey && onLabelLang && labelLang && basemap === "dark" && (
            <div style={{ marginTop: 10 }}>
              {heading("Labels · 3D globe")}
              <select
                value={labelLang}
                onChange={(e) => onLabelLang(e.target.value)}
                style={{ width: "100%", background: "rgba(255,255,255,0.05)", color: HUD.textPrimary, border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, padding: "5px 6px", fontFamily: "inherit", fontSize: 11 }}
                aria-label="Label language"
              >
                {LABEL_LANGS.map((l) => (
                  <option key={l.key} value={l.key} style={{ background: "#0b1220" }}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {onSaveImage && (
            <div style={{ marginTop: 10 }}>
              {heading("Export")}
              {row(false, Download, "Save map image", mode === "3d" ? "PNG of the globe as shown, with its layers" : "PNG of this place on this basemap", () => {
                onSaveImage();
                setOpen(false);
              }, "save-image")}
            </div>
          )}
          {bases.length < BASEMAP_IDS.length && <div style={{ fontSize: 9.5, color: HUD.textMuted, marginTop: 8, lineHeight: 1.4 }}>More basemaps (Outdoor, Topographic, Data, Toner) come with the MapTiler key in Settings.</div>}
        </div>
      )}
    </div>
  );
}

function StatusBar({ totalFeatures, clock }: { totalFeatures: number; clock: Date }) {
  return (
    <div
      className="hud-hide-phone"
      style={{
        ...glassPanel({ borderRadius: 8 }),
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: 12,
        zIndex: 500,
        display: "flex",
        gap: 16,
        fontSize: 10.5,
        letterSpacing: "0.04em",
        color: HUD.textMuted,
        padding: "6px 12px",
      }}
    >
      <span>
        TRACKS <span style={{ color: HUD.gold, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{totalFeatures}</span>
      </span>
      <span>{clock.toISOString().replace("T", " ").slice(0, 19)} UTC</span>
    </div>
  );
}

/** Top-center HUD ticker — the reference platform's own GlobalStatusBar shows an exchange
 *  open/closed row, a country-risk chip row, and a CVE count fed from
 *  /api/cyber-threats; its MarketsPanel/space-weather readout separately
 *  shows the Kp index. This is the same ticker concept, rebuilt on real,
 *  verified-licensed sources (see globalStatus.ts's file comment for
 *  exactly which the reference platform pieces were dropped or replaced and why — Markets'
 *  Yahoo scrape and Country Risk's hardcoded numbers aren't reproduced
 *  as-is). Polls every 10 minutes; each of the four calls fails
 *  independently so one slow/down upstream doesn't blank the whole ticker. */
function GlobalStatusTicker() {
  const [space, setSpace] = useState<SpaceWeather | null>(null);
  const [cyber, setCyber] = useState<CyberThreats | null>(null);
  const [markets, setMarkets] = useState<MarketsStatus | null>(null);
  const [activity, setActivity] = useState<ActivityIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getSpaceWeather().then((d) => !cancelled && setSpace(d)).catch(() => {});
      api.getCyberThreats().then((d) => !cancelled && setCyber(d)).catch(() => {});
      api.getMarkets().then((d) => !cancelled && setMarkets(d)).catch(() => {});
      api.getActivityIndex().then((d) => !cancelled && setActivity(d)).catch(() => {});
    };
    load();
    const iv = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  if (!space && !cyber && !markets && !activity) return null;

  const topActivity = activity?.countries[0];
  const crypto = markets ? Object.entries(markets.crypto) : [];
  const commodities = markets ? Object.entries(markets.commodities) : [];

  return (
    <div
      className="hud-hide-phone"
      style={{
        ...glassPanel({ borderRadius: 8 }),
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontSize: 10.5,
        letterSpacing: "0.03em",
        color: HUD.textMuted,
        padding: "6px 14px",
        whiteSpace: "nowrap",
      }}
    >
      {markets && (
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Activity size={11} color={HUD.gold} />
          <span style={{ color: HUD.textPrimary, fontWeight: 600 }}>{markets.openCount}</span>
          <span>EXCHANGES OPEN</span>
        </span>
      )}
      {commodities.map(([label, c]) => (
        <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {c.changePercent !== null && (c.changePercent >= 0 ? <TrendingUp size={11} color="#4dff9e" /> : <TrendingDown size={11} color="#ff5f6d" />)}
          <span style={{ color: HUD.textPrimary }}>{label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.value.toFixed(2)}</span>
        </span>
      ))}
      {crypto.map(([label, c]) => (
        <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {c.changePercent >= 0 ? <TrendingUp size={11} color="#4dff9e" /> : <TrendingDown size={11} color="#ff5f6d" />}
          <span style={{ color: HUD.textPrimary }}>{label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>${c.price.toLocaleString()}</span>
        </span>
      ))}
      {space && (
        <span style={{ display: "flex", alignItems: "center", gap: 5 }} title={space.stormLevel}>
          <Sun size={11} color={space.stormColor} />
          <span>SOLAR Kp</span>
          <span style={{ color: space.stormColor, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{space.kpIndex}</span>
        </span>
      )}
      {cyber && (
        <span style={{ display: "flex", alignItems: "center", gap: 5 }} title="CISA Known Exploited Vulnerabilities, added in the last 30 days">
          <Bug size={11} color={cyber.recentCount > 5 ? "#ff5f6d" : HUD.gold} />
          <span style={{ color: HUD.textPrimary, fontWeight: 600 }}>{cyber.recentCount}</span>
          <span>ACTIVE CVES</span>
        </span>
      )}
      {topActivity && (
        <span style={{ display: "flex", alignItems: "center", gap: 5 }} title="Live incident/seismic activity index (GDELT + USGS), not a risk rating">
          <AlertTriangle size={11} color="#ff9500" />
          <span>{topActivity.name.toUpperCase()}</span>
        </span>
      )}
    </div>
  );
}

/** Right-side icon rail — the dark-HUD-style vertical strip of tool buttons,
 *  mirroring the left LayerPanel's visual language (same dark glass card,
 *  same border color) but icon-only + a short label, since this rail holds
 *  tools rather than a scrollable list of toggles. */
function RightToolRail({ active, onSelect, hide = [] }: { active: RightTool; onSelect: (tool: Exclude<RightTool, null>) => void; hide?: Exclude<RightTool, null>[] }) {
  const allTools: { key: Exclude<RightTool, null>; icon: LucideIcon; label: string }[] = [
    { key: "monitor", icon: Radar, label: "Monitor" },
    { key: "listen", icon: Megaphone, label: "Listen" },
    { key: "incidents", icon: ClipboardList, label: "Incidents" },
    { key: "shapes", icon: Hexagon, label: "Studio" },
    { key: "economy", icon: Landmark, label: "Economy" },
    { key: "markets", icon: LineChart, label: "Markets" },
    { key: "draw", icon: Ruler, label: "Draw" },
    { key: "route", icon: RouteGlyph, label: "Route" },
    { key: "space", icon: Rss, label: "Space" },
    { key: "news", icon: Newspaper, label: "Alerts" },
    { key: "telegram", icon: Send, label: "Telegram" },
    { key: "events", icon: HeartPulse, label: "Events" },
    { key: "afrintel", icon: BrainCircuit, label: "AfrIntel" },
    { key: "analyses", icon: HeartHandshake, label: "Analyses" },
    { key: "crypto", icon: Wallet, label: "Crypto" },
  ];
  const tools = allTools.filter((t) => !hide.includes(t.key));
  const alertsPaused = useAlertsPaused();
  const alertsSwitch = (
    <button
      key="alerts-switch"
      onClick={() => setAlertsPaused(!alertsPaused)}
      title={alertsPaused ? "Alert pop-ups and sound are paused — click to turn them back on" : "Alert pop-ups and sound are on — click to pause them (peace of mind)"}
      style={{ width: 54, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 4px", background: alertsPaused ? "rgba(255,61,61,0.16)" : "transparent", border: "none", borderRadius: 8, color: alertsPaused ? HUD.alertRed : HUD.alertGreen, cursor: "pointer", fontFamily: "inherit" }}
    >
      {alertsPaused ? <BellOff size={16} color={HUD.alertRed} /> : <Bell size={16} color={HUD.alertGreen} />}
      <span style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>{alertsPaused ? "Paused" : "Pop-ups"}</span>
    </button>
  );
  return (
    <div style={{ ...glassPanel(), position: "relative", display: "flex", flexDirection: "column", gap: 4, padding: 4 }}>
      {tools.map((t) => (
        <Fragment key={t.key}>
        {t.key === "incidents" && alertsSwitch}
        <button
          onClick={() => onSelect(t.key)}
          title={t.label}
          style={{
            width: 54,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            padding: "8px 4px",
            background: active === t.key ? "rgba(212,175,55,0.18)" : "transparent",
            border: "none",
            borderRadius: 8,
            color: active === t.key ? HUD.gold : HUD.textMuted,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          <t.icon size={16} color={active === t.key ? HUD.gold : HUD.textMuted} />
          <span style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>{t.label}</span>
        </button>
        </Fragment>
      ))}
    </div>
  );
}

/** Shared shell every right-side tool panel renders inside — same
 *  positioning (just left of the icon rail) and card chrome as the rail
 *  itself, so opening any tool feels like one consistent system rather
 *  than four separately-designed popovers. */
/** Every right-rail tool opens in the same frame: one standard width (wide only for Economy's tables), the same
 *  glass card, and the same title line, which names the tool as the rail does. */
const PANEL_WIDTH = 400;
const PANEL_WIDE = 560;
function panelFrame(width: number = PANEL_WIDTH): React.CSSProperties {
  return { ...glassPanel(), position: "absolute", top: 12, right: 76, zIndex: 500, width: `min(${width}px, calc(100% - 100px))`, maxHeight: "calc(100% - 24px)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 };
}
const PANEL_TITLE: React.CSSProperties = { fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 };

function ToolPanelShell({ title, children, width = PANEL_WIDTH }: { title: string; children: ReactNode; width?: number }) {
  return (
    <div style={panelFrame(width)}>
      <div style={PANEL_TITLE}>{title}</div>
      {children}
    </div>
  );
}

/** Live Monitoring inside Live OSINT: the user's monitoring queries, each
 *  with a switch that draws its recent matches on the map, plus the ways
 *  into the rest of the feature — create a query, open a query's dashboard,
 *  edit, pause, delete. The dashboard and editor are full pages of their
 *  own that return here. */
function MonitoringToolPanel({
  queries,
  activeIds,
  layers,
  onToggleLayer,
  onOpen,
  onEdit,
  onNew,
  onSetActive,
  onDelete,
}: {
  queries: MonitoringQueryItem[];
  activeIds: Set<string>;
  layers: Record<string, MonitorLayerState>;
  onToggleLayer: (queryId: string) => void;
  onOpen: (queryId: string) => void;
  onEdit: (queryId: string) => void;
  onNew: () => void;
  onSetActive: (q: MonitoringQueryItem, isActive: boolean) => void;
  onDelete: (q: MonitoringQueryItem) => void;
}) {
  const linkBtn: React.CSSProperties = { background: "transparent", border: "none", padding: 0, color: HUD.textSecondary, fontSize: 10.5, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 2 };
  return (
    <div style={panelFrame()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={PANEL_TITLE}>Monitor</div>
        <button
          onClick={onNew}
          style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: `1px solid ${HUD.gold}`, background: "rgba(212,175,55,0.15)", color: HUD.gold, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}
        >
          + New query
        </button>
      </div>
      <div style={{ fontSize: 10.5, lineHeight: 1.5, color: HUD.textSecondary }}>
        Switch a query on to draw its matches from the last {MONITOR_LAYER_HOURS} hours on the map. Matches are placed where their own text says, so ones that name no place are counted but not drawn.
      </div>

      {queries.length === 0 && (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: HUD.textSecondary, padding: "14px 4px", textAlign: "center" }}>
          No monitoring queries yet. Create one to track a topic and see its results here.
        </div>
      )}

      {queries.map((q, qi) => {
        const on = activeIds.has(q.id);
        const layer = layers[q.id];
        const color = MONITOR_LAYER_COLORS[qi % MONITOR_LAYER_COLORS.length];
        return (
          <div key={q.id} style={{ border: `1px solid ${on ? "rgba(212,175,55,0.35)" : "rgba(212,175,55,0.12)"}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, opacity: q.is_active ? 1 : 0.7 }}>
            <button
              onClick={() => onToggleLayer(q.id)}
              aria-pressed={on}
              title={on ? "Hide from the map" : "Show on the map"}
              style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0, opacity: on ? 1 : 0.35 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: HUD.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.name}</span>
              <LayerToggleSwitch on={on} />
            </button>
            <div style={{ fontSize: 10.5, color: HUD.textSecondary, lineHeight: 1.45 }}>
              {q.is_active ? "Live" : "Paused"} · {q.match_count ?? 0} matches in the last 2h
              {on && (
                <>
                  <br />
                  {layer?.error ? (
                    <span style={{ color: HUD.alertOrange }}>Map layer unavailable: {layer.error}</span>
                  ) : layer?.result ? (
                    <span style={{ color: HUD.textPrimary }}>
                      On map: {layer.result.located} of {layer.result.total} matches ({MONITOR_LAYER_HOURS}h)
                    </span>
                  ) : (
                    <span>Loading map layer…</span>
                  )}
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={() => onOpen(q.id)} style={{ ...linkBtn, color: HUD.gold }}>
                Dashboard
              </button>
              <button onClick={() => onEdit(q.id)} style={linkBtn}>
                Edit
              </button>
              <button onClick={() => onSetActive(q, !q.is_active)} style={linkBtn}>
                {q.is_active ? "Pause" : "Resume"}
              </button>
              <button onClick={() => onDelete(q)} style={{ ...linkBtn, color: HUD.alertRed }}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToolButton({ active, onClick, children, disabled }: { active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        fontSize: 11,
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${active ? HUD.gold : "rgba(212,175,55,0.2)"}`,
        background: active ? "rgba(212,175,55,0.15)" : "transparent",
        color: active ? HUD.gold : HUD.textSecondary,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function DrawingToolPanel({
  mode,
  points,
  onSetMode,
  onClear,
  onExport,
  onSaveLayer,
}: {
  mode: DrawMode;
  points: LatLng[];
  onSetMode: (m: DrawMode) => void;
  onClear: () => void;
  onExport: () => void;
  onSaveLayer: () => void;
}) {
  const distanceKm = mode === "distance" ? pathDistanceKm(points) : 0;
  const areaKm2 = mode === "area" ? sphericalPolygonAreaKm2(points) : 0;
  const canExport = (mode === "distance" && points.length >= 2) || (mode === "area" && points.length >= 3);
  return (
    <ToolPanelShell title="Draw">
      <div style={{ display: "flex", gap: 6 }}>
        <ToolButton active={mode === "distance"} onClick={() => onSetMode(mode === "distance" ? null : "distance")}>
          Distance
        </ToolButton>
        <ToolButton active={mode === "area"} onClick={() => onSetMode(mode === "area" ? null : "area")}>
          Area
        </ToolButton>
      </div>
      {mode ? (
        <div style={{ fontSize: 11, color: HUD.textSecondary, lineHeight: 1.6 }}>
          Click the map to add points{mode === "area" ? " (closes automatically)" : ""}.
          <br />
          {points.length} point{points.length === 1 ? "" : "s"} placed.
          {mode === "distance" && points.length >= 2 && (
            <>
              <br />
              Distance: <b style={{ color: HUD.textPrimary }}>{formatKm(distanceKm)}</b>
            </>
          )}
          {mode === "area" && points.length >= 3 && (
            <>
              <br />
              Area: <b style={{ color: HUD.textPrimary }}>{areaKm2 >= 1 ? `${areaKm2.toFixed(1)} km²` : `${(areaKm2 * 1e6).toFixed(0)} m²`}</b>
            </>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: HUD.textMuted }}>Pick Distance or Area to start placing points.</div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <ToolButton onClick={onClear}>Clear</ToolButton>
        <ToolButton onClick={onExport}>{canExport ? "Export GeoJSON" : "Export"}</ToolButton>
      </div>
      {canExport && <ToolButton onClick={onSaveLayer}>Save as layer in Map Studio</ToolButton>}
    </ToolPanelShell>
  );
}

function RoutePlannerPanel({
  mode,
  onModeChange,
  origin,
  destination,
  result,
  loading,
  error,
  onClear,
  savedRoutes,
  routeNameDraft,
  onRouteNameDraftChange,
  routeSaving,
  onSaveRoute,
  onToggleRoute,
  onDeleteRoute,
  onRecolourRoute,
  routeStyle,
  onRouteStyle,
  onSaveRouteAsLayer,
  nearby,
  routeFeature,
  onRouteBand,
}: {
  mode: RouteProfile;
  onModeChange: (m: RouteProfile) => void;
  origin: LatLng | null;
  destination: LatLng | null;
  result: RouteResult | null;
  loading: boolean;
  error: string | null;
  onClear: () => void;
  savedRoutes: SavedRoute[];
  routeNameDraft: string;
  onRouteNameDraftChange: (v: string) => void;
  routeSaving: boolean;
  onSaveRoute: () => void;
  onToggleRoute: (id: string, visible: boolean) => void;
  onDeleteRoute: (id: string) => void;
  onRecolourRoute: (id: string, color: string) => void;
  routeStyle: RouteStyle;
  onRouteStyle: (p: Partial<RouteStyle>) => void;
  onSaveRouteAsLayer: () => void;
  nearby: { incidents: IncidentItem[]; state: NearbyState | null; viewMode: "markers" | "heatmap"; onResults: (rows: IncidentItem[] | null, s: NearbyState | null) => void; onViewMode: (m: "markers" | "heatmap") => void };
  routeFeature: GeoJSON.Feature | null;
  onRouteBand: (km: number) => void;
}) {
  const profiles: { key: RouteProfile; label: string }[] = [
    { key: "driving", label: "Drive" },
    { key: "walking", label: "Walk" },
    { key: "cycling", label: "Bike" },
  ];
  return (
    <ToolPanelShell title="Route">
      <div style={{ display: "flex", gap: 4 }}>
        {profiles.map((p) => (
          <ToolButton key={p.key} active={mode === p.key} onClick={() => onModeChange(p.key)}>
            {p.label}
          </ToolButton>
        ))}
      </div>
      <div style={{ fontSize: 11, color: HUD.textSecondary, lineHeight: 1.6 }}>
        {!origin && "Click the map to set an origin."}
        {origin && !destination && "Now click a destination."}
        {origin && destination && !loading && !error && !result && "Routing…"}
      </div>
      {loading && <div style={{ fontSize: 11, color: HUD.textMuted }}>Routing…</div>}
      {error && <div style={{ fontSize: 11, color: HUD.alertRed }}>{error}</div>}
      {result && (
        <div style={{ fontSize: 11, color: HUD.textSecondary, lineHeight: 1.6 }}>
          Distance: <b style={{ color: HUD.textPrimary }}>{formatKm(result.distanceMeters / 1000)}</b>
          <br />
          Duration: <b style={{ color: HUD.textPrimary }}>{formatDuration(result.durationSeconds)}</b>
        </div>
      )}
      <RouteStyleControls style={routeStyle} onChange={onRouteStyle} />
      {routeFeature && (
        <NearbySearch
          title="Incidents along this route"
          geometry={routeFeature}
          label="route"
          incidents={nearby.incidents}
          state={nearby.state}
          viewMode={nearby.viewMode}
          onResults={nearby.onResults}
          onViewMode={nearby.onViewMode}
          onCorridor={onRouteBand}
        />
      )}
      <div style={{ fontSize: 10, color: HUD.textMuted, lineHeight: 1.5 }}>
        Road routes from OpenStreetMap data, through several routing servers in turn, so one being down does not stop routing.
      </div>
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
          <input
            value={routeNameDraft}
            onChange={(e) => onRouteNameDraftChange(e.target.value)}
            placeholder="Name this route…"
            style={hudInputStyle}
          />
          <ToolButton onClick={onSaveRoute}>{routeSaving ? "Saving…" : "Save route (overlays the map)"}</ToolButton>
          <ToolButton onClick={onSaveRouteAsLayer}>Save as editable layer in Map Studio</ToolButton>
        </div>
      )}
      <ToolButton onClick={onClear}>Clear</ToolButton>

      {savedRoutes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>
            Saved routes ({savedRoutes.length})
          </div>
          {savedRoutes.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <input type="checkbox" checked={r.visible} onChange={(e) => onToggleRoute(r.id, e.target.checked)} />
              <span style={{ flex: 1, color: HUD.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>
                {r.name}
              </span>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(r.color ?? "") ? (r.color as string) : "#4dff9e"} onChange={(e) => onRecolourRoute(r.id, e.target.value)} title="Route colour" style={{ width: 20, height: 18, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
              <span style={{ color: HUD.textMuted, fontSize: 10 }}>{r.distance_km ? `${r.distance_km.toFixed(0)}km` : ""}</span>
              <button onClick={() => onDeleteRoute(r.id)} title="Delete" style={iconOnlyBtnStyle}>
                <CloseGlyph size={11} color={HUD.textMuted} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToolPanelShell>
  );
}

const hudInputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgba(212,175,55,0.2)",
  background: "rgba(0,0,0,0.3)",
  color: HUD.textPrimary,
  fontFamily: "inherit",
};

const iconOnlyBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 2,
  display: "flex",
  alignItems: "center",
};

function LiveSpacePanel({ pos, error }: { pos: IssPosition | null; error: string | null }) {
  return (
    <ToolPanelShell title="Space">
      {error && <div style={{ fontSize: 11, color: HUD.alertRed }}>{error}</div>}
      {pos ? (
        <div style={{ fontSize: 11, color: HUD.textSecondary, lineHeight: 1.6 }}>
          ISS position: <b style={{ color: HUD.textPrimary }}>{pos.lat.toFixed(2)}, {pos.lng.toFixed(2)}</b>
          <br />
          Ground speed: <b style={{ color: HUD.textPrimary }}>~{pos.speedKmh.toLocaleString()} km/h</b>
          <br />
          As of {new Date(pos.timestamp).toLocaleTimeString()}
        </div>
      ) : (
        !error && <div style={{ fontSize: 11, color: HUD.textMuted }}>Locating ISS…</div>
      )}
      <div style={{ borderRadius: 6, overflow: "hidden", aspectRatio: "16 / 9", background: "#000" }}>
        <iframe
          title="NASA live"
          src="https://www.youtube.com/embed/live_stream?channel=UCLA_DiR1FfKNvjuUpBHmylQ&autoplay=0&mute=1"
          style={{ width: "100%", height: "100%", border: "none" }}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div style={{ fontSize: 10, color: HUD.textMuted }}>NASA's public live channel — plays whatever NASA currently has live (ISS views, launches, briefings).</div>
    </ToolPanelShell>
  );
}


/** Every categorical field the Incidents tool's search offers, in display
 *  order — label plus the matching key in both IncidentFilterState and
 *  IncidentFilterOptions (api's IncidentFilters). Kept as one ordered list
 *  so the select-building loop below and any future field addition stay
 *  in one place. */
const INCIDENT_FILTER_FIELDS: { key: keyof IncidentFilterOptions & keyof IncidentFilterState; label: string }[] = [
  { key: "country", label: "Country" },
  { key: "province", label: "Province" },
  { key: "county", label: "County" },
  { key: "district", label: "District" },
  { key: "city", label: "City" },
  { key: "suburb", label: "Suburb" },
  { key: "sector", label: "Sector" },
  { key: "actor", label: "Actor" },
  { key: "tactic", label: "Tactic" },
  { key: "severity", label: "Severity" },
  { key: "operation", label: "Operation" },
  { key: "target", label: "Target" },
  { key: "interest_group", label: "Interest Group" },
  { key: "actual_main_victim", label: "Main Victim" },
  { key: "intended_primary_target", label: "Intended Target" },
];

/** Incidents tool — full search across every categorical field plus a date
 *  range (same set IncidentSearch's full-page view offers, just in this
 *  260px rail), export to Excel/CSV of the complete matching set, bulk
 *  delete of the same, and the two intake paths (Add one / Bulk upload)
 *  that reuse IncidentManualEntry/IncidentUpload unmodified via the intake
 *  modal below, since both are full-page forms not built for this rail. */
function IncidentsToolPanel({
  filterOptions,
  draft,
  onDraftChange,
  appliedCount,
  resultCount,
  loading,
  loadAll,
  onLoadAll,
  loadedCount,
  onSearch,
  onClear,
  onAdd,
  onBulkUpload,
  onDailyReview,
  onBulkDelete,
  bulkDeleting,
  onExport,
  exporting,
  viewMode,
  onViewModeChange,
  bubbles,
  onBubbles,
  iconMode,
  onIconModeChange,
  heatmapStyle,
  onHeatmapStyleChange,
}: {
  filterOptions: IncidentFilterOptions | null;
  draft: IncidentFilterState;
  onDraftChange: (f: IncidentFilterState) => void;
  appliedCount: number;
  resultCount: number | null;
  loading: boolean;
  loadAll: boolean;
  onLoadAll: (v: boolean) => void;
  loadedCount: number;
  onSearch: () => void;
  onClear: () => void;
  onAdd: () => void;
  onBulkUpload: () => void;
  onDailyReview: () => void;
  onBulkDelete: () => void;
  bulkDeleting: boolean;
  onExport: (format: "xlsx" | "csv") => void;
  exporting: "xlsx" | "csv" | null;
  viewMode: "markers" | "heatmap";
  bubbles: boolean;
  onBubbles: (v: boolean) => void;
  onViewModeChange: (m: "markers" | "heatmap") => void;
  iconMode: "actor" | "tactic";
  onIconModeChange: (m: "actor" | "tactic") => void;
  heatmapStyle: HeatmapStyle;
  onHeatmapStyleChange: (s: HeatmapStyle | ((prev: HeatmapStyle) => HeatmapStyle)) => void;
}) {
  const hasDraft = Object.values(draft).some(Boolean);
  const hasApplied = appliedCount > 0;
  function select(field: (typeof INCIDENT_FILTER_FIELDS)[number]) {
    return (
      <select
        key={field.key}
        value={draft[field.key] ?? ""}
        onChange={(e) => onDraftChange({ ...draft, [field.key]: e.target.value || undefined })}
        style={{ ...hudInputStyle, cursor: "pointer" }}
      >
        <option value="">{field.label}: All</option>
        {filterOptions?.[field.key]?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <ToolPanelShell title="Incidents">
      <div style={{ display: "flex", gap: 6 }}>
        <ToolButton onClick={onAdd}>+ Add one</ToolButton>
        <ToolButton onClick={onBulkUpload}>Bulk upload</ToolButton>
        <ToolButton onClick={onDailyReview}>Daily review</ToolButton>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted, display: "flex", alignItems: "center", gap: 5 }}>
          <SearchGlyph size={11} /> Search all incidents
        </div>

        {INCIDENT_FILTER_FIELDS.map(select)}

        <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted, paddingTop: 4 }}>
          Date of occurrence
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: HUD.textSecondary }}>
            Start date
            <input
              type="date"
              value={draft.from ?? ""}
              onChange={(e) => onDraftChange({ ...draft, from: e.target.value || undefined })}
              style={{ ...hudInputStyle, width: "100%" }}
            />
          </label>
          <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: HUD.textSecondary }}>
            End date
            <input
              type="date"
              value={draft.to ?? ""}
              onChange={(e) => onDraftChange({ ...draft, to: e.target.value || undefined })}
              style={{ ...hudInputStyle, width: "100%" }}
            />
          </label>
        </div>
        <MonthQuickFilter onPick={(bounds) => onDraftChange({ ...draft, ...bounds })} />

        <div style={{ display: "flex", gap: 6, paddingTop: 4 }}>
          <ToolButton active onClick={onSearch} disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </ToolButton>
          {(hasDraft || hasApplied) && <ToolButton onClick={onClear}>Clear</ToolButton>}
        </div>
      </div>

      <div style={{ fontSize: 11, color: HUD.textSecondary }}>
        {loading
          ? "Searching…"
          : hasApplied
          ? `${(resultCount ?? 0).toLocaleString()} incident${resultCount === 1 ? "" : "s"} match — all shown on the map`
          : "Enable \"My Incidents\" (under My Data, left rail) to see your incidents on the map. Set filters above and press Search to narrow that down. A search always shows every match."}
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, color: HUD.textSecondary, cursor: "pointer" }}>
        <input type="checkbox" checked={loadAll} onChange={(e) => onLoadAll(e.target.checked)} />
        <span>Load all incidents on the map (default is the latest 2,000){loadAll ? ` — ${loadedCount.toLocaleString()} loaded; use Heatmap if it feels slow` : ""}</span>
      </label>

      {/* 2D/map/sat modes only — Map3D keeps the generic colored-dot
          rendering, since these bullet icons/popups/heatmap are Leaflet-only. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>
          Display on map (2D / Map / Sat)
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <ToolButton active={viewMode === "markers" && !bubbles} onClick={() => { onViewModeChange("markers"); onBubbles(false); }}>Icons</ToolButton>
          <ToolButton active={viewMode === "markers" && bubbles} onClick={() => { onViewModeChange("markers"); onBubbles(true); }}>Count bubbles</ToolButton>
          <ToolButton active={viewMode === "heatmap"} onClick={() => onViewModeChange("heatmap")}>Heatmap</ToolButton>
        </div>
        {viewMode === "markers" && (
          <div style={{ display: "flex", gap: 6 }}>
            <ToolButton active={iconMode === "actor"} onClick={() => onIconModeChange("actor")}>Icon: Actor</ToolButton>
            <ToolButton active={iconMode === "tactic"} onClick={() => onIconModeChange("tactic")}>Icon: Tactic</ToolButton>
          </div>
        )}
        {viewMode === "heatmap" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <HeatmapControls
              style={heatmapStyle}
              onChange={onHeatmapStyleChange}
              labelStyle={{ color: HUD.textMuted }}
              selectStyle={{ ...hudInputStyle, cursor: "pointer" }}
            />
          </div>
        )}
      </div>

      {hasApplied && !loading && (resultCount ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>Download matching incidents</div>
          <div style={{ display: "flex", gap: 6 }}>
            <ToolButton onClick={() => onExport("xlsx")} disabled={exporting !== null}>
              {exporting === "xlsx" ? "Exporting…" : "Excel"}
            </ToolButton>
            <ToolButton onClick={() => onExport("csv")} disabled={exporting !== null}>
              {exporting === "csv" ? "Exporting…" : "CSV"}
            </ToolButton>
          </div>

          <ToolButton onClick={onBulkDelete} disabled={bulkDeleting}>
            {bulkDeleting ? "Deleting…" : `Delete all ${(resultCount ?? 0).toLocaleString()} matching`}
          </ToolButton>
          <div style={{ fontSize: 10, color: HUD.textMuted }}>
            Both act on every incident currently matched by the filters above — not just what's visible on screen.
          </div>
        </div>
      )}
    </ToolPanelShell>
  );
}

const RISK_COLOR: Record<string, string> = { critical: HUD.alertRed, high: HUD.alertOrange, medium: "#ffd23f", low: HUD.textSecondary, info: HUD.textMuted };

/** Crypto Intel tool — on-chain wallet lookup (BTC/ETH/SOL) via
 *  api.getCryptoIntel, adapted from the reference platform's chainIntel module. A one-off
 *  address lookup, not a polled map layer — see that module's own comment
 *  for the full (entirely keyless) source list. */
function CryptoToolPanel({
  address,
  onAddressChange,
  chain,
  onChainChange,
  onLookup,
  result,
  loading,
  error,
}: {
  address: string;
  onAddressChange: (v: string) => void;
  chain: ChainKind | "";
  onChainChange: (v: ChainKind | "") => void;
  onLookup: () => void;
  result: WalletIntel | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <ToolPanelShell title="Crypto">
      <div style={{ fontSize: 11, color: HUD.textSecondary }}>
        Look up a Bitcoin, Ethereum or Solana address: balance, activity, counterparties, and an OFAC sanctions screen.
      </div>
      <input
        value={address}
        onChange={(e) => onAddressChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onLookup()}
        placeholder="Wallet address…"
        style={hudInputStyle}
      />
      <select value={chain} onChange={(e) => onChainChange(e.target.value as ChainKind | "")} style={{ ...hudInputStyle, cursor: "pointer" }}>
        <option value="">Auto-detect chain</option>
        <option value="bitcoin">Bitcoin</option>
        <option value="ethereum">Ethereum</option>
        <option value="solana">Solana</option>
      </select>
      <ToolButton active onClick={onLookup} disabled={loading || !address.trim()}>
        {loading ? "Looking up…" : "Look up"}
      </ToolButton>

      {error && <div style={{ fontSize: 11, color: HUD.alertRed }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: HUD.textPrimary, fontWeight: 700 }}>{result.chain_label}</span>
            <span style={{ color: RISK_COLOR[result.risk.level], fontWeight: 700, textTransform: "uppercase" }}>{result.risk.level}</span>
          </div>

          {result.sanctions.hit && (
            <div style={{ fontSize: 11, color: HUD.alertRed, background: "rgba(255,61,61,0.12)", padding: 6, borderRadius: 6 }}>
              ⚠ OFAC SDN match: {result.sanctions.entries.map((e) => e.name).join("; ")}
            </div>
          )}

          <div style={{ fontSize: 11, color: HUD.textSecondary }}>
            Balance: {result.balance.native.toLocaleString(undefined, { maximumFractionDigits: 6 })} {result.symbol}
            {result.balance.usd !== null && ` (~$${result.balance.usd.toLocaleString(undefined, { maximumFractionDigits: 0 })})`}
          </div>
          <div style={{ fontSize: 11, color: HUD.textSecondary }}>
            {result.activity.tx_count.toLocaleString()} transactions
            {result.activity.age_days !== null && ` · ${result.activity.age_days}d old`}
            {result.activity.dormant_days !== null && ` · last active ${result.activity.dormant_days}d ago`}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>Risk factors ({result.risk.score}/100)</div>
            {result.risk.factors.map((f) => (
              <div key={f.code} style={{ fontSize: 11, color: HUD.textSecondary }}>
                <span style={{ color: RISK_COLOR[f.severity], fontWeight: 600 }}>{f.label}</span> — {f.detail}
              </div>
            ))}
          </div>

          {result.counterparties.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>
                Top counterparties ({result.counterparties.length})
              </div>
              {result.counterparties.slice(0, 6).map((cp) => (
                <div key={cp.address} style={{ fontSize: 10.5, color: HUD.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cp.address}>
                  {cp.address.slice(0, 10)}…{cp.address.slice(-6)} — {cp.txs} tx, {cp.direction}
                </div>
              ))}
            </div>
          )}

          {result.partial.length > 0 && (
            <div style={{ fontSize: 10, color: HUD.textMuted }}>{result.partial.join(" · ")}</div>
          )}
          <div style={{ fontSize: 10, color: HUD.textMuted }}>Sources: {result.sources.join(", ")}</div>
        </div>
      )}
    </ToolPanelShell>
  );
}

/** Tone score → a short human label + color, since "-3.7" means nothing to
 *  someone reading a HUD panel — GDELT's tone scale runs roughly -10 (very
 *  negative) to +10 (very positive), with most real-world coverage
 *  clustering close to 0. */
function toneLabel(tone: number): { label: string; color: string } {
  if (tone <= -5) return { label: "Very negative", color: HUD.alertRed };
  if (tone <= -1.5) return { label: "Negative", color: HUD.alertOrange };
  if (tone < 1.5) return { label: "Neutral", color: HUD.textSecondary };
  if (tone < 5) return { label: "Positive", color: HUD.alertGreen };
  return { label: "Very positive", color: HUD.alertGreen };
}

/** Inserts a boolean-query operator/token at the end of the current query
 *  string, with a leading space if needed — a lightweight "query builder"
 *  rather than a full syntax-aware editor, since GDELT's own query grammar
 *  is simple enough (bare terms=AND, OR, "phrase", -negate, (group)) that a
 *  handful of insert buttons plus the hint text below covers it. */
function insertToken(current: string, token: string): string {
  const trimmed = current.replace(/\s+$/, "");
  if (!trimmed) return token === "OR" || token === "NOT" ? "" : token;
  return `${trimmed} ${token} `.replace(/ +/g, " ");
}

const QUERY_BUILDER_TOKENS: { label: string; token: string; title: string }[] = [
  { label: "AND", token: "AND", title: "Both terms must appear (GDELT treats adjacent bare terms as AND by default)" },
  { label: "OR", token: "OR", title: "Either term may appear — must be uppercase" },
  { label: "NOT", token: "-", title: "Excludes the next term, e.g. -rumor" },
  { label: '" "', token: '""', title: "Exact phrase — type inside the quotes" },
  { label: "( )", token: "()", title: "Group terms, e.g. (coup OR mutiny) AND Sahel" },
];

/** Social Listening tool — a boolean query builder plus a Search tab
 *  (one live search) and a Dashboard tab (every saved query at a glance),
 *  covering GDELT (news/blog tone + volume trend, boolean-query aware) and,
 *  if configured, Mastodon (real public posts, plain-text search only). See
 *  socialListening.ts for exactly what was checked and why each source was
 *  included/excluded, and for the sourceErrors this panel now surfaces
 *  instead of silently showing an empty result. */
function SocialListeningPanel({
  tab,
  onTabChange,
  query,
  onQueryChange,
  onSearch,
  result,
  loading,
  error,
  saveName,
  onSaveNameChange,
  onSaveQuery,
  saving,
  savedQueries,
  onRunSaved,
  onTogglePinned,
  onDeleteSaved,
  liveData,
  liveErrors,
  liveLoading,
  onRefreshSaved,
}: {
  tab: "search" | "dashboard";
  onTabChange: (t: "search" | "dashboard") => void;
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  result: SocialListeningResult | null;
  loading: boolean;
  error: string | null;
  saveName: string;
  onSaveNameChange: (v: string) => void;
  onSaveQuery: () => void;
  saving: boolean;
  savedQueries: SavedListeningQuery[];
  onRunSaved: (q: SavedListeningQuery) => void;
  onTogglePinned: (q: SavedListeningQuery) => void;
  onDeleteSaved: (id: string) => void;
  liveData: Record<string, SocialListeningResult | null>;
  liveErrors: Record<string, string | null>;
  liveLoading: Record<string, boolean>;
  onRefreshSaved: (id: string) => void;
}) {
  return (
    <div style={panelFrame()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={PANEL_TITLE}>Listen</div>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: 2 }}>
          {(["search", "dashboard"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              style={{
                border: "none",
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 10,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                background: tab === t ? "rgba(212,175,55,0.2)" : "transparent",
                color: tab === t ? HUD.gold : HUD.textMuted,
              }}
            >
              {t === "search" ? "Search" : `Dashboard${savedQueries.length ? ` (${savedQueries.length})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      {tab === "search" ? (
        <SocialListeningSearchTab
          query={query}
          onQueryChange={onQueryChange}
          onSearch={onSearch}
          result={result}
          loading={loading}
          error={error}
          saveName={saveName}
          onSaveNameChange={onSaveNameChange}
          onSaveQuery={onSaveQuery}
          saving={saving}
        />
      ) : (
        <SocialListeningDashboardTab
          savedQueries={savedQueries}
          onRunSaved={onRunSaved}
          onTogglePinned={onTogglePinned}
          onDeleteSaved={onDeleteSaved}
          liveData={liveData}
          liveErrors={liveErrors}
          liveLoading={liveLoading}
          onRefresh={onRefreshSaved}
        />
      )}
    </div>
  );
}

function SocialListeningSearchTab({
  query,
  onQueryChange,
  onSearch,
  result,
  loading,
  error,
  saveName,
  onSaveNameChange,
  onSaveQuery,
  saving,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  result: SocialListeningResult | null;
  loading: boolean;
  error: string | null;
  saveName: string;
  onSaveNameChange: (v: string) => void;
  onSaveQuery: () => void;
  saving: boolean;
}) {
  const maxVolume = result ? Math.max(1, ...result.volumeTimeline.map((p) => p.count)) : 1;
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 6 }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder='e.g. (coup OR mutiny) AND Sahel -rumor'
            style={{ ...hudInputStyle, flex: 1, fontFamily: "var(--font-mono, monospace)" }}
          />
          <ToolButton onClick={onSearch}>{loading ? "…" : "Search"}</ToolButton>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {QUERY_BUILDER_TOKENS.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.title}
              onClick={() => onQueryChange(insertToken(query, t.token))}
              style={{
                border: "1px solid rgba(212,175,55,0.25)",
                background: "rgba(212,175,55,0.06)",
                color: HUD.gold,
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                fontFamily: "var(--font-mono, monospace)",
                padding: "2px 7px",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </form>
      <div style={{ fontSize: 10, color: HUD.textMuted, lineHeight: 1.5 }}>
        Sentiment/volume from GDELT's worldwide news & blog coverage (7-day window), which understands the boolean query above natively — AND/OR/NOT and
        "quoted phrases" work exactly as typed. Mastodon's post search does <b>not</b> support boolean operators, so it matches your terms as plain text.
        Reddit and X/Twitter aren't included (checked directly: Reddit's Data API Terms bar commercial use without a paid license, and X requires a paid
        enterprise tier). Coverage is also plotted on the map by country (last 24h) while this panel is open — country-level, not exact article locations.
      </div>
      {error && <div style={{ fontSize: 11, color: HUD.alertRed }}>{error}</div>}

      {result && (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={saveName}
              onChange={(e) => onSaveNameChange(e.target.value)}
              placeholder="Name this search to save it…"
              style={{ ...hudInputStyle, flex: 1 }}
            />
            <ToolButton onClick={onSaveQuery} disabled={saving || !saveName.trim()}>
              {saving ? "…" : "Save"}
            </ToolButton>
          </div>

          {result.latestTone !== null ? (
            <div style={{ fontSize: 12, color: HUD.textSecondary }}>
              Latest tone:{" "}
              <b style={{ color: toneLabel(result.latestTone).color }}>
                {toneLabel(result.latestTone).label} ({result.latestTone.toFixed(1)})
              </b>
            </div>
          ) : result.sourceErrors?.tone ? (
            <div style={{ fontSize: 10, color: HUD.alertRed }}>Tone unavailable: {result.sourceErrors.tone}</div>
          ) : (
            <div style={{ fontSize: 10, color: HUD.textMuted }}>No tone data — no news/blog coverage found for this query in the last 7 days.</div>
          )}

          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted, marginBottom: 4 }}>Coverage volume (7d)</div>
            {result.volumeTimeline.length > 0 ? (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36 }}>
                {result.volumeTimeline.map((p, i) => (
                  <div
                    key={i}
                    title={`${new Date(p.date).toLocaleDateString()}: ${p.count}`}
                    style={{ flex: 1, height: `${Math.max(6, (p.count / maxVolume) * 36)}px`, background: HUD.gold, opacity: 0.6, borderRadius: 2 }}
                  />
                ))}
              </div>
            ) : result.sourceErrors?.volume ? (
              <div style={{ fontSize: 10, color: HUD.alertRed }}>Volume unavailable: {result.sourceErrors.volume}</div>
            ) : (
              <div style={{ fontSize: 10, color: HUD.textMuted }}>No coverage volume for this query in the last 7 days.</div>
            )}
          </div>

          <div style={{ fontSize: 10, color: HUD.textMuted }}>
            {result.sourceErrors?.geo ? (
              <span style={{ color: HUD.alertRed }}>Map points unavailable: {result.sourceErrors.geo}</span>
            ) : result.geoPoints.length > 0 ? (
              <span style={{ color: HUD.cyan }}>{result.geoPoints.length} countr{result.geoPoints.length === 1 ? "y" : "ies"} plotted on the map (last 24h, country-level)</span>
            ) : (
              "No country-level coverage for this query in the last 24h."
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>Top coverage</div>
            {result.topArticles.length > 0 ? (
              result.topArticles.slice(0, 8).map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  <div style={{ fontSize: 11.5, color: HUD.textPrimary, lineHeight: 1.35 }}>{a.title}</div>
                  <div style={{ fontSize: 10, color: HUD.textMuted }}>{a.domain}</div>
                </a>
              ))
            ) : result.sourceErrors?.articles ? (
              <div style={{ fontSize: 10, color: HUD.alertRed }}>Articles unavailable: {result.sourceErrors.articles}</div>
            ) : (
              <div style={{ fontSize: 10, color: HUD.textMuted }}>No articles matched this query.</div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>Public social posts (Mastodon)</div>
            {!result.mastodonAvailable && (
              <div style={{ fontSize: 10, color: HUD.textMuted }}>Not configured — set MASTODON_ACCESS_TOKEN to enable.</div>
            )}
            {result.mastodonAvailable && result.sourceErrors?.mastodon && (
              <div style={{ fontSize: 10, color: HUD.alertRed }}>Mastodon unavailable: {result.sourceErrors.mastodon}</div>
            )}
            {result.mastodonAvailable && !result.sourceErrors?.mastodon && result.mastodonPosts.length === 0 && (
              <div style={{ fontSize: 10, color: HUD.textMuted }}>No recent public posts found for this keyword.</div>
            )}
            {result.mastodonPosts.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <div style={{ fontSize: 11, color: HUD.textPrimary, lineHeight: 1.35 }}>{p.content}</div>
                <div style={{ fontSize: 10, color: HUD.textMuted }}>
                  {p.author} · {new Date(p.createdAt).toLocaleString()}
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Dashboard tab — every saved query at a glance (tone + coverage volume),
 *  each with a pin toggle (pinning adds it to the left rail's Social
 *  Listening flyout, where it's then live-polled) and a delete. This is
 *  what makes the tool a "dashboard for listening" rather than one search
 *  box: several named watches checked side by side instead of re-typing a
 *  query every time. */
function SocialListeningDashboardTab({
  savedQueries,
  onRunSaved,
  onTogglePinned,
  onDeleteSaved,
  liveData,
  liveErrors,
  liveLoading,
  onRefresh,
}: {
  savedQueries: SavedListeningQuery[];
  onRunSaved: (q: SavedListeningQuery) => void;
  onTogglePinned: (q: SavedListeningQuery) => void;
  onDeleteSaved: (id: string) => void;
  liveData: Record<string, SocialListeningResult | null>;
  liveErrors: Record<string, string | null>;
  liveLoading: Record<string, boolean>;
  onRefresh: (id: string) => void;
}) {
  if (savedQueries.length === 0) {
    return (
      <div style={{ fontSize: 11, color: HUD.textMuted, lineHeight: 1.5 }}>
        No saved queries yet. Run a search in the Search tab, name it, and hit Save to add it here — saved queries can then be pinned to the map's left
        rail as a live toggle.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {savedQueries.map((q) => {
        const live = liveData[q.id];
        const err = liveErrors[q.id];
        return (
          <div key={q.id} style={{ border: "1px solid rgba(212,175,55,0.15)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button
                onClick={() => onRunSaved(q)}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                title="Open in Search"
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: HUD.textPrimary }}>{q.name}</div>
              </button>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => onRefresh(q.id)}
                  disabled={liveLoading[q.id]}
                  title="Fetch latest now (manual — this doesn't auto-poll, to avoid piling onto GDELT's shared rate limit)"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: liveLoading[q.id] ? HUD.textMuted : HUD.cyan,
                    cursor: liveLoading[q.id] ? "wait" : "pointer",
                    padding: 0,
                    display: "flex",
                  }}
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  onClick={() => onTogglePinned(q)}
                  title={q.pinned ? "Unpin from left rail" : "Pin to left rail"}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(212,175,55,0.25)",
                    borderRadius: 4,
                    color: q.pinned ? HUD.gold : HUD.textMuted,
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "2px 6px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {q.pinned ? "Pinned" : "Pin"}
                </button>
                <button onClick={() => onDeleteSaved(q.id)} title="Delete" style={{ background: "transparent", border: "none", color: HUD.textMuted, cursor: "pointer", padding: 0 }}>
                  <CloseGlyph size={13} />
                </button>
              </div>
            </div>
            <div style={{ fontSize: 10, color: HUD.textMuted, fontFamily: "var(--font-mono, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {q.query}
            </div>
            {err ? (
              <div style={{ fontSize: 10, color: HUD.alertRed }}>{err}</div>
            ) : live ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 10.5 }}>
                {live.latestTone !== null ? (
                  <span style={{ color: toneLabel(live.latestTone).color, fontWeight: 700 }}>
                    {toneLabel(live.latestTone).label} ({live.latestTone.toFixed(1)})
                  </span>
                ) : (
                  <span style={{ color: HUD.textMuted }}>No tone data</span>
                )}
                <span style={{ color: HUD.textSecondary }}>{live.topArticles.length} articles</span>
                {live.mastodonAvailable && <span style={{ color: HUD.textSecondary }}>{live.mastodonPosts.length} posts</span>}
              </div>
            ) : liveLoading[q.id] ? (
              <div style={{ fontSize: 10, color: HUD.textMuted }}>Fetching…</div>
            ) : (
              <div style={{ fontSize: 10, color: HUD.textMuted }}>No data yet — hit the refresh icon to fetch (fetching is manual, not automatic).</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Full-screen intake modal for Add-one / Bulk-upload — a modal rather than
 *  cramming these into the 260px tool rail, since both IncidentManualEntry
 *  and IncidentUpload are full-page forms (max-width 640–760) already used
 *  elsewhere in the app unmodified; this view just hosts them. */
function IncidentIntakeModal({
  tab,
  onTabChange,
  onClose,
  onSaved,
}: {
  tab: "add" | "bulk" | "review";
  onTabChange: (t: "add" | "bulk" | "review") => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,3,8,0.78)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflowY: "auto",
        padding: "40px 20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ ...glassPanel(), width: tab === "review" ? "min(1280px, 100%)" : "min(820px, 100%)", padding: 20, background: "rgba(10,12,22,0.97)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <ToolButton active={tab === "add"} onClick={() => onTabChange("add")}>
              Add one
            </ToolButton>
            <ToolButton active={tab === "bulk"} onClick={() => onTabChange("bulk")}>
              Bulk upload
            </ToolButton>
            <ToolButton active={tab === "review"} onClick={() => onTabChange("review")}>
              Daily review
            </ToolButton>
          </div>
          <button onClick={onClose} title="Close" style={iconOnlyBtnStyle}>
            <CloseGlyph size={18} color={HUD.textSecondary} />
          </button>
        </div>
        <div style={{ color: "#111", background: "#fff", borderRadius: 8, padding: 16 }}>
          <Suspense fallback={<div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
            {tab === "add" ? <IncidentManualEntry onSaved={onSaved} /> : tab === "bulk" ? <IncidentUpload onUploaded={onSaved} /> : <IncidentReview onPushed={onSaved} />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/**
 * An escalation marker on the flat map. Resting the pointer on it opens a
 * card with what is being reported there and links that can be clicked;
 * the card stays open while the pointer is on the marker or on the card,
 * so a link can be reached. Clicking the marker itself opens Liveuamap's
 * map of that country, as it does on the 3D map.
 */
/** The escalation triangle on the flat map: the same drawing and size as on the 3D globe (mapSymbols.ts). */
function warningMarkerIcon(level: EscalationLevel) {
  const h = WARNING_SIZE[level];
  return divIcon({ className: "lens-warning-icon", html: `<img src="${warningIconUrl(level)}" width="${h}" height="${h}" alt="" style="display:block">`, iconSize: [h, h], iconAnchor: [h / 2, h], popupAnchor: [0, -h], tooltipAnchor: [0, -h] });
}

function EscalationFlatMarker({ lat, lng, level, incident }: { lat: number; lng: number; level: EscalationLevel; incident: EscalationIncident }) {
  const marker = useRef<LeafletMarker>(null);
  const timer = useRef<number | undefined>(undefined);
  const stay = () => window.clearTimeout(timer.current);
  const closeSoon = () => {
    stay();
    timer.current = window.setTimeout(() => marker.current?.closePopup(), 350);
  };
  useEffect(() => stay, []);
  return (
    <Marker
      ref={marker}
      position={[lat, lng]}
      icon={warningMarkerIcon(level)}
      eventHandlers={{
        mouseover: () => {
          stay();
          marker.current?.openPopup();
        },
        mouseout: closeSoon,
        click: () => {
          openLiveuamap(liveuamapLink(incident.countryCode, lat, lng, incident.geoPrecision));
          // Leaflet closes an open popup on click; keep the card up.
          window.setTimeout(() => marker.current?.openPopup(), 0);
        },
      }}
    >
      <LeafletPopup className="lens-hover-leaflet" closeButton={false} autoPan={false} offset={[0, -2]}>
        <div onMouseEnter={stay} onMouseLeave={closeSoon}>
          <EscalationHoverCard incident={incident} clickHint="CLICK THE MARKER TO OPEN LIVEUAMAP THERE" />
        </div>
      </LeafletPopup>
    </Marker>
  );
}
