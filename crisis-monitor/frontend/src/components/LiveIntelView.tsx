import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MapContainer, TileLayer, CircleMarker, Polygon, Polyline, Tooltip as LeafletTooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  Bug,
  Building2,
  CloudLightning,
  Flame,
  MapPin,
  Mountain,
  Navigation,
  Network,
  Newspaper,
  Plane,
  Radiation,
  Radio,
  Route as RouteGlyph,
  Rss,
  Ruler,
  Satellite,
  Shield,
  Ship,
  Siren,
  Sun,
  Telescope,
  Waypoints,
  X as CloseGlyph,
  type LucideIcon,
} from "lucide-react";
import Map3D from "./Map3D";
import { api, type LiveLayerCollection, type LiveLayerFeature, type IssPosition, type NewsItem, type RouteProfile, type RouteResult } from "../api";
import { BASEMAPS } from "./mapConstants";

/**
 * OSIRIS's real visual language — checked directly against its open-source
 * repo (github.com/enzg/osiris-live, src/app/globals.css): a gold "Eye of
 * Horus" accent on a near-black glass panel, JetBrains Mono throughout,
 * uppercase/tracked headers, not the blue HUD palette this view launched
 * with. Kept as local constants (not pushed into the app's shared
 * globals.css) so this one view's restyle can't leak into any other part
 * of the app. Map/data-point colors (per-layer dot colors, route/draw
 * colors) are deliberately NOT reassigned to this palette — those encode
 * real data (layer identity, alert severity) and OSIRIS's own layer dots
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

/** A glass-panel container, OSIRIS's own .glass-panel rule ported to inline
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
 * "Live Intelligence" — a new, separate view rather than a restyle of the
 * existing (light) dashboards/choropleth. Modeled on OSIRIS's own dark HUD
 * aesthetic (osirisai.live): a grouped, toggleable layer panel on the left,
 * a rotating 3D globe (or a flat 2D/Map/Sat projection, switchable) with
 * crisp country-level boundary lines, and monospace status readouts.
 * Nothing here touches IncidentsMap/IncidentSearch or their data.
 *
 * The 3D globe deliberately does NOT use a photographic/satellite Earth
 * texture — that's a "Sat" look, and OSIRIS's own 3D view is a dark
 * data-vis map (flat black sphere, thin white national borders, a subtle
 * lat/lng graticule), not imagery. Country outlines come from the same
 * world-atlas topology already bundled for the choropleth/GlobeWidget
 * elsewhere in this app (world-atlas/countries-110m.json), rendered as
 * three-globe polygons with a transparent fill and a visible stroke only —
 * "Sat" as an actual satellite photo basemap is reserved for the flat 2D
 * mode switcher below, matching what OSIRIS's own 3D/2D/Map/Sat buttons do.
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
 *  - Global Incidents: OSIRIS's real flyout pairs this with GDELT Events,
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
 *    Not one of OSIRIS's own Threats & Intel rows, but a legitimate
 *    addition of another already-integrated real feed.
 *  - My Incidents / Live Alert Pins: this account's own data, already
 *    scoped by the backend's normal auth (client/country restrictions
 *    apply exactly as they do everywhere else in the app) — reusing the
 *    existing /api/incidents and /api/alerts endpoints rather than a new
 *    route. Live Alert Pins lives under Threats & Intel (matching OSIRIS's
 *    real grouping), not My Data, even though it's the same per-account
 *    alert data "My Alerts" always was.
 *  - Maritime: checked directly against OSIRIS's own open-source code
 *    (github.com/enzg/osiris-live) rather than assumed to have live AIS —
 *    it turns out OSIRIS's "Maritime" layer is itself a static reference
 *    dataset (major ports, naval bases, shipping chokepoints with real
 *    published stats), refreshed once a day, zero external API calls.
 *  - Deliberately NOT included: live CCTV, and the "Recon Toolkit" /
 *    "Marauder" style device-scanning tools OSIRIS's own UI shows — those
 *    are active reconnaissance/surveillance capabilities, not data layers,
 *    and this app isn't going to carry them regardless of whether a
 *    backend exists to power them. Submarine cables: a real open dataset
 *    exists but wasn't confirmed reachable in time for this pass.
 *
 * Right-side toolbar — OSIRIS shows several of these as its own icon rail;
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
}

type LayerGroup = "Natural Hazards" | "Threats & Intel" | "Network Intel" | "Aviation" | "Maritime" | "Space Tracking" | "My Data";

/** Icon + accent for a group's own rail button — every group renders
 *  through the same flyout treatment now (see LayerPanel/GroupRailButton),
 *  including a group with only one real layer, confirmed directly against
 *  OSIRIS's own real Maritime flyout. */
const GROUP_META: Record<LayerGroup, { icon: LucideIcon; color: string }> = {
  // CloudLightning matches a direct screenshot of OSIRIS's own rail icon
  // for this group (a cloud-with-lightning glyph, not a generic pulse icon).
  "Natural Hazards": { icon: CloudLightning, color: HUD.alertOrange },
  // Real label ("Threats & Intel", not "Threats & Infra") confirmed
  // directly from a screenshot of OSIRIS's own flyout header.
  "Threats & Intel": { icon: AlertTriangle, color: HUD.alertRed },
  // Network icon matches a direct screenshot of OSIRIS's own rail icon for
  // this group (a 3-node hierarchy/network glyph, distinct from Threats &
  // Intel's triangle).
  "Network Intel": { icon: Network, color: "#ff4fa3" },
  Aviation: { icon: Plane, color: HUD.cyan },
  Maritime: { icon: Ship, color: "#00BCD4" },
  "Space Tracking": { icon: Satellite, color: "#9d7bff" },
  "My Data": { icon: Bell, color: HUD.gold },
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
        // OSIRIS's own points render as tiny flat 2D circles (roughly 3-9px,
        // via MapLibre) — three-globe's pointsData markers are real 3D
        // discs, which read as chunky next to that at any size much above
        // this. Kept small and in a narrow range on purpose to match that
        // crisp, minimal feel rather than the bigger default scale.
        size: 0.1 + f.properties.intensity * 0.16,
        title: f.properties.title,
        subtitle: `${f.properties.intensityLabel}${f.properties.detail ? ` — ${f.properties.detail}` : ""}`,
        time: f.properties.time,
        url: f.properties.url,
      }));
}

const LAYER_DEFS: LayerDef[] = [
  { key: "earthquakes", label: "Earthquakes", group: "Natural Hazards", color: "#ff5d5d", icon: Activity, fetcher: async () => fromGateway("#ff5d5d", "Earthquakes")(await api.getLiveEarthquakes()) },
  // Both real rows below share NASA EONET's own event feed, split by the
  // category EONET itself already assigns each event (see the backend's
  // classifyNaturalEvent()) — matching OSIRIS's real "NATURAL HAZARDS"
  // flyout (EARTHQUAKES / ACTIVE FIRES / SEVERE WEATHER), confirmed
  // directly from a screenshot of its actual flyout rather than assumed.
  {
    key: "active-fires",
    label: "Active Fires",
    group: "Natural Hazards",
    color: "#ffb020",
    icon: Flame,
    fetcher: async () => fromGateway("#ffb020", "Active Fires", (f) => f.properties.naturalHazardCategory === "wildfire")(await api.getLiveNaturalEvents()),
  },
  {
    key: "severe-weather",
    label: "Severe Weather",
    group: "Natural Hazards",
    color: "#4fd1ff",
    icon: CloudLightning,
    fetcher: async () => fromGateway("#4fd1ff", "Severe Weather", (f) => f.properties.naturalHazardCategory === "severe-weather")(await api.getLiveNaturalEvents()),
  },
  // Four real rows below match OSIRIS's own "THREATS & INTEL" flyout
  // (confirmed directly from a screenshot: NUCLEAR FACILITIES / GLOBAL
  // INCIDENTS / LIVE ALERT PINS / GDELT EVENTS), each backed by genuinely
  // real, sourced data rather than a guess at what OSIRIS's own numbers
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
  {
    key: "global-incidents",
    label: "Global Incidents",
    group: "Threats & Intel",
    color: "#ff9d4f",
    icon: Siren,
    fetcher: async () => fromGateway("#ff9d4f", "Global Incidents")(await api.getLiveGlobalIncidents()),
  },
  {
    key: "live-alert-pins",
    label: "Live Alert Pins",
    group: "Threats & Intel",
    color: "#ffd23f",
    icon: Bell,
    fetcher: async () => {
      // Same real per-query alert data "My Alerts" always used (see
      // below) — regrouped and relabeled here to match OSIRIS's real
      // "Live Alert Pins" row living under Threats & Intel rather than a
      // separate "My Data" group.
      const queries = await api.getQueries();
      const perQuery = await Promise.allSettled(queries.map((q) => api.getAlerts({ query_id: q.id, status: "open" })));
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
  { key: "conflict-events", label: "GDELT Events", group: "Threats & Intel", color: "#7c9cff", icon: AlertTriangle, fetcher: async () => fromGateway("#7c9cff", "GDELT Events")(await api.getLiveConflictEvents()) },
  // OSIRIS's own real "NETWORK INTEL" group (confirmed from a screenshot:
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
  // Three real, sourced categories rather than OSIRIS's full four — see
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
    label: "Commercial",
    group: "Aviation",
    color: "#2fe0c8",
    icon: Plane,
    fetcher: async () => fromGateway("#2fe0c8", "Commercial Flights", (f) => f.properties.aviationClass === "commercial")(await api.getLiveAirTraffic()),
  },
  {
    key: "air-traffic-private",
    label: "Private",
    group: "Aviation",
    color: "#00E676",
    icon: Plane,
    fetcher: async () => fromGateway("#00E676", "Private Aircraft", (f) => f.properties.aviationClass === "private")(await api.getLiveAirTraffic()),
  },
  {
    key: "air-traffic-military",
    label: "Military",
    group: "Aviation",
    color: "#FF3D3D",
    icon: Shield,
    fetcher: async () => fromGateway("#FF3D3D", "Military Aircraft", (f) => f.properties.aviationClass === "military")(await api.getLiveAirTraffic()),
  },
  {
    key: "maritime",
    // OSIRIS's own real label for this layer (a screenshot of its
    // MARITIME group flyout shows "MARITIME / NAVAL" as the one row) —
    // this app's data is still the same real static reference set (major
    // ports, naval bases, shipping chokepoints), just named to match.
    label: "Maritime / Naval",
    group: "Maritime",
    color: "#3fd0ff",
    icon: Anchor,
    fetcher: async () => fromGateway("#3fd0ff", "Maritime")(await api.getLiveMaritime()),
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
  {
    key: "my-incidents",
    label: "My Incidents",
    group: "My Data",
    color: "#ff9de2",
    icon: MapPin,
    fetcher: async () => {
      const rows = await api.getIncidents({ limit: 2000 });
      const out: GlobePoint[] = [];
      for (const r of rows) {
        if (r.latitude == null || r.longitude == null) continue;
        out.push({
          id: r.id,
          layerKey: "My Incidents",
          lat: r.latitude,
          lng: r.longitude,
          color: "#ff9de2",
          size: 0.16,
          title: r.city || r.district || r.country || "Incident",
          subtitle: [r.sector, r.tactic].filter(Boolean).join(" — "),
          time: r.occurred_at,
          url: null,
        });
      }
      return out;
    },
  },
];

const GROUP_ORDER: LayerGroup[] = ["Natural Hazards", "Threats & Intel", "Network Intel", "Aviation", "Maritime", "Space Tracking", "My Data"];

/** Major real global container-shipping trunk routes, drawn as arcs
 *  between the hub ports the backend's /maritime layer already lists.
 *  OSIRIS itself has no shipping-lane rendering at all (checked directly
 *  against its source — no lane/route code exists there, and its "ship"
 *  layer is wired to a backend field that's never actually populated), so
 *  this isn't matching something OSIRIS has; it's a legitimate addition of
 *  well-known real trade routes, tied to the same Maritime toggle. Only
 *  drawn in 3D mode — a flat equirectangular Polyline through these same
 *  raw coordinates would visibly wrap the wrong way around the antimeridian
 *  on several of these Pacific-crossing routes, which is worse than not
 *  showing them there at all. */
const SHIPPING_LANES: { points: [number, number][]; label: string }[] = [
  { points: [[31.23, 121.47], [33.74, -118.27]], label: "Transpacific — Shanghai–Los Angeles" },
  { points: [[35.10, 129.04], [33.74, -118.27]], label: "Transpacific — Busan–Los Angeles" },
  { points: [[31.23, 121.47], [1.26, 103.84], [25.01, 55.06]], label: "Asia–Middle East — Shanghai–Singapore–Jebel Ali" },
  { points: [[1.26, 103.84], [51.90, 4.50]], label: "Asia–Europe — Singapore–Rotterdam" },
  { points: [[51.90, 4.50], [32.08, -81.09]], label: "Transatlantic — Rotterdam–Savannah" },
  { points: [[31.23, 121.47], [1.26, 103.84]], label: "Intra-Asia trunk — Shanghai–Singapore" },
];

const POLL_MS = 60_000;

type LayerState = { data: GlobePoint[] | null; loading: boolean; error: string | null };
type MapMode = "3d" | "2d" | "map" | "sat";

/** Which right-side tool panel is open, if any — at most one at a time, both
 *  because that's simpler state to reason about and because Drawing Tools
 *  and Route both interpret a map/globe click as their own next action, so
 *  two active together would fight over the same click. */
type RightTool = "draw" | "route" | "space" | "news" | null;
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
  a.download = `live-intel-${mode}-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LiveIntelView() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    earthquakes: true,
    "active-fires": true,
    "severe-weather": true,
    "conflict-events": true,
    "nuclear-facilities": false,
    "global-incidents": false,
    "live-alert-pins": false,
    "air-traffic-commercial": false,
    "air-traffic-private": false,
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
    // Decoupled from the "maritime" points layer above (ports/bases/
    // chokepoints) — this toggles the shipping-lane arcs (SHIPPING_LANES)
    // instead, matching OSIRIS's own real product having a separate
    // "Maritime Lines" toggle alongside its points-based "Maritime / Naval"
    // layer (confirmed directly from a screenshot of its actual left rail,
    // not the open-source mirror, which has no lines concept at all).
    "maritime-lines": false,
  });
  const [mapMode, setMapMode] = useState<MapMode>("3d");
  const [layers, setLayers] = useState<Record<string, LayerState>>(() =>
    Object.fromEntries(LAYER_DEFS.map((d) => [d.key, { data: null, loading: true, error: null }]))
  );
  const [clock, setClock] = useState(() => new Date());

  // DISPLAY toggles — OSIRIS's own left-panel group of the same name (its
  // real source labels them "Day / Night Cycle" and gates buildings/terrain
  // by zoom rather than a manual switch; see LayerPanel/Map3D's own
  // comments for exactly what each does).
  const [showDayNight, setShowDayNight] = useState(false);
  const [showBuildings, setShowBuildings] = useState(false);
  const [showTerrain, setShowTerrain] = useState(false);

  // --- Right-side tools: at most one open at a time (see RightTool). ---
  const [activeTool, setActiveTool] = useState<RightTool>(null);

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

  const [newsItems, setNewsItems] = useState<NewsItem[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

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
    if (activeTool !== "news") return;
    let cancelled = false;
    async function poll() {
      setNewsLoading(true);
      try {
        const feed = await api.getLiveNews();
        if (!cancelled) {
          setNewsItems(feed.items);
          setNewsError(null);
        }
      } catch (err) {
        if (!cancelled) setNewsError(err instanceof Error ? err.message : "News feed unavailable");
      } finally {
        if (!cancelled) setNewsLoading(false);
      }
    }
    poll();
    const interval = setInterval(poll, 300_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTool]);

  useEffect(() => {
    let cancelled = false;
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
    LAYER_DEFS.forEach(loadLayer);
    const interval = setInterval(() => LAYER_DEFS.forEach(loadLayer), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
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
      const data = layers[def.key]?.data;
      if (data) all.push(...data);
    }
    return all;
  }, [layers, enabled]);

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
    return extra;
  }, [activeTool, issPos, routeOrigin, routeDestination, drawPoints]);

  const mapPoints = useMemo(() => [...points, ...toolPoints], [points, toolPoints]);

  // Draw/route lines, merged alongside the shipping lanes for the 3D globe's
  // single pathsData layer — a color field on each entry (shipping lanes
  // have none, so they fall back to their usual blue) is what tells
  // pathColor apart, rather than needing three separate path layers.
  const globePaths = useMemo(() => {
    const lanes = enabled["maritime-lines"] ? SHIPPING_LANES : [];
    const drawPath =
      drawMode === "distance" && drawPoints.length >= 2 ? [{ points: drawPoints, label: "Measured distance", color: "#ffd23f" }] : [];
    const routePath =
      routeResult && routeResult.coordinates.length >= 2
        ? [{ points: routeResult.coordinates.map(([lng, lat]) => [lat, lng] as LatLng), label: "Route", color: "#4dff9e" }]
        : [];
    return [...lanes, ...drawPath, ...routePath];
  }, [enabled["maritime-lines"], drawMode, drawPoints, routeResult]);

  // The in-progress area-drawing shape, as a closed ring — country borders
  // themselves no longer need to be built here at all now that the 3D view
  // is a real vector-tile basemap (Map3D) that already draws them as part
  // of its own style.
  const drawAreaRing = useMemo<LatLng[] | null>(() => {
    if (drawMode !== "area" || drawPoints.length < 3) return null;
    return [...drawPoints, drawPoints[0]];
  }, [drawMode, drawPoints]);

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
      <div style={{ position: "relative", flex: 1 }}>
        {mapMode === "3d" ? (
          <Map3D
            points={mapPoints}
            paths={globePaths}
            drawAreaRing={drawAreaRing}
            onMapClick={handleMapClick}
            showDayNight={showDayNight}
            showBuildings={showBuildings}
            showTerrain={showTerrain}
          />
        ) : (
          <FlatMap
            mode={mapMode}
            points={mapPoints}
            onMapClick={activeTool === "draw" || activeTool === "route" ? handleMapClick : undefined}
            drawMode={activeTool === "draw" ? drawMode : null}
            drawPoints={drawPoints}
            routeLine={activeTool === "route" ? routeLineForFlatMap : undefined}
          />
        )}

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
          maritimeLinesCount={SHIPPING_LANES.length}
          onToggleMaritimeLines={() => setEnabled((prev) => ({ ...prev, "maritime-lines": !prev["maritime-lines"] }))}
        />
        <MapModeSwitcher mode={mapMode} onChange={setMapMode} />
        {mapMode === "3d" && (
          <DisplayPanel
            dayNight={showDayNight}
            buildings={showBuildings}
            terrain={showTerrain}
            onToggleDayNight={() => setShowDayNight((v) => !v)}
            onToggleBuildings={() => setShowBuildings((v) => !v)}
            onToggleTerrain={() => setShowTerrain((v) => !v)}
          />
        )}
        <StatusBar totalFeatures={points.length} clock={clock} />

        <RightToolRail
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
              return next;
            })
          }
        />

        {activeTool === "draw" && (
          <DrawingToolPanel
            mode={drawMode}
            points={drawPoints}
            onSetMode={(m) => {
              setDrawMode(m);
              setDrawPoints([]);
            }}
            onClear={() => setDrawPoints([])}
            onExport={() => downloadDrawingAsGeoJson(drawPoints, drawMode)}
          />
        )}
        {activeTool === "route" && (
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
          />
        )}
        {activeTool === "space" && <LiveSpacePanel pos={issPos} error={issError} />}
        {activeTool === "news" && <NewsFeedPanel items={newsItems} loading={newsLoading} error={newsError} />}
      </div>
    </div>
  );
}

/** The flat-projection modes (2D / Map / Sat) reuse the same Leaflet stack
 *  already powering IncidentsMap/IncidentSearch elsewhere in this app,
 *  rather than trying to make three-globe fake a flat view — it's a real
 *  2D map, not a globe photographed from directly above. "2D" and "Map"
 *  both use street-style tiles (2D dark, Map light) — Sat uses satellite
 *  imagery, matching what the three style buttons mean on OSIRIS itself. */
function FlatMap({
  mode,
  points,
  onMapClick,
  drawMode,
  drawPoints,
  routeLine,
}: {
  mode: Exclude<MapMode, "3d">;
  points: GlobePoint[];
  /** Set only while Drawing Tools or Route is the active right-side tool —
   *  its presence is literally what makes a map click do something. */
  onMapClick?: (lat: number, lng: number) => void;
  drawMode?: DrawMode;
  drawPoints?: LatLng[];
  routeLine?: LatLng[];
}) {
  const tile = mode === "sat" ? BASEMAPS.esriImagery : mode === "map" ? BASEMAPS.osm : BASEMAPS.dark;
  return (
    <MapContainer center={[15, 20]} zoom={2} minZoom={2} worldCopyJump style={{ height: "100%", width: "100%", background: "#000308" }}>
      <TileLayer url={tile.url} attribution={tile.attribution} />
      {onMapClick && <MapClickCapture onClick={onMapClick} />}
      {drawMode === "distance" && drawPoints && drawPoints.length >= 2 && (
        <Polyline positions={drawPoints} pathOptions={{ color: "#ffd23f", weight: 2 }} />
      )}
      {drawMode === "area" && drawPoints && drawPoints.length >= 3 && (
        <Polygon positions={drawPoints} pathOptions={{ color: "#ffd23f", fillColor: "#ffd23f", fillOpacity: 0.25, weight: 2 }} />
      )}
      {routeLine && routeLine.length >= 2 && <Polyline positions={routeLine} pathOptions={{ color: "#4dff9e", weight: 3 }} />}
      {points.map((p) => (
        <CircleMarker key={`${p.layerKey}:${p.id}`} center={[p.lat, p.lng]} radius={3 + p.size * 18} pathOptions={{ color: p.color, fillColor: p.color, fillOpacity: 0.6, weight: 1 }}>
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
      ))}
    </MapContainer>
  );
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

/** Left-side layer panel — OSIRIS's own collapsed icon rail (its real left
 *  sidebar, seen icon-only) rather than the wide labeled list this view
 *  first shipped: one group per rail icon, vertically stacked in group
 *  order. Every group — even a group with only one real layer, like
 *  Maritime — renders through the same GroupRailButton: a live-count badge
 *  on the rail icon itself, and hovering opens a flyout with the group
 *  name, an enable/disable-everything button reading "ALL" or "NONE"
 *  depending on the group's own current state, a close (×), and one
 *  toggle+count row per layer, matching direct screenshots of OSIRIS's own
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
}: {
  defs: LayerDef[];
  enabled: Record<string, boolean>;
  layers: Record<string, LayerState>;
  onToggle: (key: string) => void;
  onToggleGroup: (group: LayerGroup, nextOn: boolean) => void;
  maritimeLinesOn: boolean;
  maritimeLinesCount: number;
  onToggleMaritimeLines: () => void;
}) {
  const groupedRows = useMemo(() => GROUP_ORDER.map((group) => defs.filter((d) => d.group === group)).filter((rows) => rows.length > 0), [defs]);

  return (
    <div style={{ ...glassPanel(), position: "absolute", top: 12, left: 12, zIndex: 500, display: "flex", flexDirection: "column", gap: 2, padding: 5 }}>
      <div style={{ borderBottom: "1px solid rgba(212,175,55,0.12)", paddingBottom: 4, marginBottom: 2 }}>
        <RailHoverToggle
          icon={Waypoints}
          label="Maritime Lines"
          on={maritimeLinesOn}
          count={maritimeLinesCount}
          onToggle={onToggleMaritimeLines}
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
    </div>
  );
}

/** A group's rail button — one icon standing in for several layers, exactly
 *  matching direct screenshots of OSIRIS's own AVIATION and NATURAL
 *  HAZARDS flyouts: hovering opens a card with the group name, an
 *  enable/disable-everything button (labeled "ALL" when every row is on,
 *  "NONE" otherwise — OSIRIS's own flyout showed "NONE" with all three
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
                    fixed label — matches a direct screenshot of OSIRIS's
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
 *  OSIRIS's own top-of-rail "Maritime Lines" control: hovering the icon
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

/** OSIRIS's own .layer-toggle: a 28×14 pill, gold-tinted + gold-glowing
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

function MapModeSwitcher({ mode, onChange }: { mode: MapMode; onChange: (m: MapMode) => void }) {
  const options: { key: MapMode; label: string }[] = [
    { key: "3d", label: "3D" },
    { key: "2d", label: "2D" },
    { key: "map", label: "Map" },
    { key: "sat", label: "Sat" },
  ];
  return (
    <div style={{ ...glassPanel(), position: "absolute", left: 12, bottom: 44, zIndex: 500, display: "flex", gap: 2, padding: 3 }}>
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 700,
            padding: "5px 11px",
            borderRadius: 8,
            border: "none",
            background: mode === opt.key ? "rgba(212,175,55,0.18)" : "transparent",
            color: mode === opt.key ? HUD.gold : HUD.textMuted,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** OSIRIS's own left-panel "DISPLAY" group (its real source: LayerPanel.tsx
 *  — Day/Night Cycle, plus the 3D Buildings/3D Terrain toggles from its own
 *  bottom-left panel screenshots) — visual/rendering switches rather than
 *  data layers, so they get their own small panel next to the mode
 *  switcher instead of living among the data-layer toggles above. Only
 *  meaningful in 3D mode (Map3D is the only renderer that implements any
 *  of the three), hence only shown there. */
function DisplayPanel({
  dayNight,
  buildings,
  terrain,
  onToggleDayNight,
  onToggleBuildings,
  onToggleTerrain,
}: {
  dayNight: boolean;
  buildings: boolean;
  terrain: boolean;
  onToggleDayNight: () => void;
  onToggleBuildings: () => void;
  onToggleTerrain: () => void;
}) {
  const rows: { label: string; hint?: string; icon: LucideIcon; on: boolean; onToggle: () => void }[] = [
    { label: "Day / Night Cycle", icon: Sun, on: dayNight, onToggle: onToggleDayNight },
    { label: "3D Buildings", hint: "City detail — zoom 14.5+", icon: Building2, on: buildings, onToggle: onToggleBuildings },
    { label: "3D Terrain", hint: "Mountains — zoom 10+", icon: Mountain, on: terrain, onToggle: onToggleTerrain },
  ];
  return (
    <div style={{ ...glassPanel(), position: "absolute", left: 12, bottom: 84, zIndex: 500, width: 210, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, letterSpacing: "0.15em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 }}>
        <Sun size={12} color={HUD.gold} />
        Display
      </div>
      {rows.map((r) => (
        <button
          key={r.label}
          onClick={r.onToggle}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0 }}
        >
          <r.icon size={13} color={r.on ? HUD.gold : HUD.textMuted} />
          <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <span style={{ fontSize: 11.5, color: r.on ? HUD.textPrimary : HUD.textSecondary }}>{r.label}</span>
            {r.hint && <span style={{ fontSize: 9.5, color: HUD.textMuted }}>{r.hint}</span>}
          </span>
          <LayerToggleSwitch on={r.on} />
        </button>
      ))}
    </div>
  );
}

function StatusBar({ totalFeatures, clock }: { totalFeatures: number; clock: Date }) {
  return (
    <div
      style={{
        ...glassPanel({ borderRadius: 8 }),
        position: "absolute",
        left: 12,
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

/** Right-side icon rail — the OSIRIS-style vertical strip of tool buttons,
 *  mirroring the left LayerPanel's visual language (same dark glass card,
 *  same border color) but icon-only + a short label, since this rail holds
 *  tools rather than a scrollable list of toggles. */
function RightToolRail({ active, onSelect }: { active: RightTool; onSelect: (tool: Exclude<RightTool, null>) => void }) {
  const tools: { key: Exclude<RightTool, null>; icon: LucideIcon; label: string }[] = [
    { key: "draw", icon: Ruler, label: "Draw" },
    { key: "route", icon: RouteGlyph, label: "Route" },
    { key: "space", icon: Rss, label: "Space" },
    { key: "news", icon: Newspaper, label: "Alerts" },
  ];
  return (
    <div style={{ ...glassPanel(), position: "absolute", top: 12, right: 12, zIndex: 500, display: "flex", flexDirection: "column", gap: 4, padding: 4 }}>
      {tools.map((t) => (
        <button
          key={t.key}
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
      ))}
    </div>
  );
}

/** Shared shell every right-side tool panel renders inside — same
 *  positioning (just left of the icon rail) and card chrome as the rail
 *  itself, so opening any tool feels like one consistent system rather
 *  than four separately-designed popovers. */
function ToolPanelShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ ...glassPanel(), position: "absolute", top: 12, right: 76, zIndex: 500, width: 260, maxHeight: "calc(100% - 24px)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  );
}

function ToolButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        fontSize: 11,
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${active ? HUD.gold : "rgba(212,175,55,0.2)"}`,
        background: active ? "rgba(212,175,55,0.15)" : "transparent",
        color: active ? HUD.gold : HUD.textSecondary,
        cursor: "pointer",
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
}: {
  mode: DrawMode;
  points: LatLng[];
  onSetMode: (m: DrawMode) => void;
  onClear: () => void;
  onExport: () => void;
}) {
  const distanceKm = mode === "distance" ? pathDistanceKm(points) : 0;
  const areaKm2 = mode === "area" ? sphericalPolygonAreaKm2(points) : 0;
  const canExport = (mode === "distance" && points.length >= 2) || (mode === "area" && points.length >= 3);
  return (
    <ToolPanelShell title="Drawing Tools">
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
}: {
  mode: RouteProfile;
  onModeChange: (m: RouteProfile) => void;
  origin: LatLng | null;
  destination: LatLng | null;
  result: RouteResult | null;
  loading: boolean;
  error: string | null;
  onClear: () => void;
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
      <div style={{ fontSize: 10, color: HUD.textMuted, lineHeight: 1.5 }}>
        Routed via OSRM's free public demo server — fine for occasional use, not a guaranteed production service.
      </div>
      <ToolButton onClick={onClear}>Clear</ToolButton>
    </ToolPanelShell>
  );
}

function LiveSpacePanel({ pos, error }: { pos: IssPosition | null; error: string | null }) {
  return (
    <ToolPanelShell title="Live From Space">
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

function NewsFeedPanel({ items, loading, error }: { items: NewsItem[] | null; loading: boolean; error: string | null }) {
  return (
    <ToolPanelShell title="Live Alerts">
      {loading && !items && <div style={{ fontSize: 11, color: HUD.textMuted }}>Loading headlines…</div>}
      {error && <div style={{ fontSize: 11, color: HUD.alertRed }}>{error}</div>}
      {items && items.length === 0 && !error && <div style={{ fontSize: 11, color: HUD.textMuted }}>No headlines available right now.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items?.map((item) => (
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noreferrer"
            style={{ display: "block", textDecoration: "none", padding: "6px 0", borderBottom: "1px solid rgba(124,156,255,0.1)" }}
          >
            <div style={{ fontSize: 12, color: HUD.textPrimary, lineHeight: 1.35 }}>{item.title}</div>
            <div style={{ fontSize: 10, color: HUD.textMuted, marginTop: 2 }}>
              {item.source}
              {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleString()}` : ""}
            </div>
          </a>
        ))}
      </div>
    </ToolPanelShell>
  );
}
