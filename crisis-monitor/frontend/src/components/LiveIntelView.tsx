import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { MapContainer, TileLayer, CircleMarker, Polygon, Polyline, Tooltip as LeafletTooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  Bug,
  Building2,
  Cable,
  ClipboardList,
  CloudLightning,
  Flame,
  Hexagon,
  Landmark,
  MapPin,
  Megaphone,
  Mountain,
  Navigation,
  Network,
  Newspaper,
  Plane,
  Radiation,
  Radio,
  RefreshCw,
  Route as RouteGlyph,
  Rss,
  Ruler,
  Satellite,
  Search as SearchGlyph,
  Shield,
  Ship,
  Siren,
  Sun,
  Telescope,
  TrendingDown,
  TrendingUp,
  Upload as UploadGlyph,
  Waypoints,
  X as CloseGlyph,
  type LucideIcon,
} from "lucide-react";
import Map3D from "./Map3D";
import {
  api,
  type LiveLayerCollection,
  type LiveLayerFeature,
  type IssPosition,
  type NewsItem,
  type RouteProfile,
  type RouteResult,
  type SpaceWeather,
  type CyberThreats,
  type MarketsStatus,
  type ActivityIndex,
  type IncidentItem,
  type IncidentFilters as IncidentFilterOptions,
  type SavedShape,
  type SavedRoute,
  type EconomicIndicators,
  type SocialListeningResult,
  type SavedListeningQuery,
} from "../api";
import { BASEMAPS } from "./mapConstants";
// Lazy — IncidentUpload pulls in the xlsx parser (400+ KB), not worth
// loading for every visit to this view when the intake modal may never
// open (same lazy-load pattern DashboardWidgetCard already uses for
// RouteDrawingGlobe/LabelDrawingGlobe).
const IncidentManualEntry = lazy(() => import("./IncidentManualEntry"));
const IncidentUpload = lazy(() => import("./IncidentUpload"));

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
  /** Conflict Escalation only — see Map3D.tsx's own field of the same name.
   *  Undefined on every other layer. */
  escalationLevel?: "elevated" | "critical";
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
      // separate "My Data" group. Also pulls in the unscoped (query_id
      // NULL) country-escalation alerts from countryEscalation.ts — a
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
  { key: "conflict-events", label: "GDELT Events", group: "Threats & Intel", color: "#7c9cff", icon: AlertTriangle, fetcher: async () => fromGateway("#7c9cff", "GDELT Events")(await api.getLiveConflictEvents()) },
  // Country-level "is this deteriorating right now" overlay (backend:
  // countryEscalation.ts) — one point per African country currently flagged
  // Elevated/Critical, placed at that country's centroid, not one point per
  // raw event like GDELT Events/Global Incidents above. Popup detail already
  // carries the analytical breakdown (current vs. baseline count, tone,
  // sample locations) behind the flag — the same text used in the alert
  // this scoring raises, so there's no separate click-to-drill-down step
  // needed to see the reasoning.
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
          color: level === "critical" ? "#ff5d5d" : "#ff9d4f",
          // Bigger and pinned to a fixed size per level (not intensity-
          // scaled like the point layers) — this is meant to read as a
          // deliberate warning marker, not just another dot in the swarm.
          size: level === "critical" ? 0.4 : 0.3,
          title: f.properties.title,
          subtitle: f.properties.detail,
          time: f.properties.time,
          url: f.properties.url,
          escalationLevel: level,
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
    label: "UCDP Conflict Events",
    group: "Threats & Intel",
    color: "#ff6b6b",
    icon: Siren,
    fetcher: async () => fromGateway("#ff6b6b", "UCDP Conflict Events")(await api.getLiveUcdpConflictEvents()),
  },
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
  {
    key: "my-incidents",
    label: "My Incidents",
    group: "My Data",
    color: "#ff9de2",
    icon: MapPin,
    fetcher: async () => {
      const rows = await api.getIncidents({ limit: 2000 });
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
    color: "#ff9de2",
    size: 0.16,
    title: r.city || r.district || r.country || "Incident",
    subtitle: [r.sector, r.tactic].filter(Boolean).join(" — "),
    time: r.occurred_at,
    url: null,
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

const GROUP_ORDER: LayerGroup[] = ["Natural Hazards", "Threats & Intel", "Network Intel", "Aviation", "Maritime", "Space Tracking", "My Data"];

/** Real global shipping-lane geometries now come from the backend's
 *  /api/live-layers/maritime-lines (see LayerState below and
 *  backend/src/data/maritimeLanes.ts) instead of being hand-approximated
 *  here. That data is computed via searoute-js over a real maritime
 *  network graph (Eurostat marnet + Oak Ridge National Labs' Global
 *  Shipping Lane Network), which threads real chokepoints — Suez,
 *  Gibraltar, Panama, Malacca, Bab-el-Mandeb, the Danish Straits — rather
 *  than a straight chord across land, and gives a genuinely dense web of
 *  ~40 real trunk routes (not a handful of hand-picked ones) to match how
 *  dense real shipping-lane visualizations look. OSIRIS itself has no
 *  shipping-lane rendering at all (checked directly against its source —
 *  no lane/route code exists there, and its "ship" layer is wired to a
 *  backend field that's never actually populated), so this isn't matching
 *  something OSIRIS has; it's a legitimate addition of real trade routes,
 *  tied to the same Maritime toggle. Only drawn in 3D mode — a flat
 *  equirectangular Polyline through these same raw coordinates would
 *  visibly wrap the wrong way around the antimeridian on the Pacific
 *  routes, which is worse than not showing them there at all. */

const POLL_MS = 60_000;

type LayerState = { data: GlobePoint[] | null; loading: boolean; error: string | null };
type MapMode = "3d" | "2d" | "map" | "sat";

/** Which right-side tool panel is open, if any — at most one at a time, both
 *  because that's simpler state to reason about and because Drawing Tools
 *  and Route both interpret a map/globe click as their own next action, so
 *  two active together would fight over the same click. */
type RightTool = "draw" | "route" | "space" | "news" | "incidents" | "shapes" | "economy" | "listen" | null;
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
    "conflict-escalation": true,
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
    // chokepoints) — this toggles the shipping-lane arcs (maritimeLanes,
    // fetched from the backend) instead, matching OSIRIS's own real
    // product having a separate
    // "Maritime Lines" toggle alongside its points-based "Maritime / Naval"
    // layer (confirmed directly from a screenshot of its actual left rail,
    // not the open-source mirror, which has no lines concept at all).
    "maritime-lines": false,
    "submarine-cables": false,
    "ais-vessels": false,
    "ucdp-conflict-events": false,
  });
  const [mapMode, setMapMode] = useState<MapMode>("3d");
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

  // --- Economy tool: World Bank indicators (GDP, growth, inflation, trade)
  // across Afrilens's African coverage set — fetched lazily on first open,
  // since these barely change and there's no reason to poll them. ---
  const [econData, setEconData] = useState<EconomicIndicators | null>(null);
  const [econLoading, setEconLoading] = useState(false);
  const [econError, setEconError] = useState<string | null>(null);
  const [econSortKey, setEconSortKey] = useState<string>("gdpUsd");
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
  const [incidentModalTab, setIncidentModalTab] = useState<"add" | "bulk" | null>(null);
  const [incidentBulkDeleting, setIncidentBulkDeleting] = useState(false);
  const [incidentExporting, setIncidentExporting] = useState<"xlsx" | "csv" | null>(null);

  // --- Shapes tool: persisted AOI overlays (map_shapes), drawn here and
  // shown on the map alongside every live layer and incident. ---
  const [savedShapes, setSavedShapes] = useState<SavedShape[]>([]);
  const [shapeDrawing, setShapeDrawing] = useState(false);
  const [shapeDrawPoints, setShapeDrawPoints] = useState<LatLng[]>([]);
  const [shapeNameDraft, setShapeNameDraft] = useState("");
  const [shapeColorDraft, setShapeColorDraft] = useState("#7dd3fc");
  const [shapeSaving, setShapeSaving] = useState(false);
  const [shapeError, setShapeError] = useState<string | null>(null);

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
  function refreshRoutes() {
    api.getMapRoutes().then(setSavedRoutes).catch(() => {});
  }

  // Refetches both the base "My Incidents" layer and, if a search is
  // active, the filtered result set — called right after an Add-one or
  // Bulk-upload save so a freshly-entered incident appears immediately
  // instead of waiting for the next 60s poll.
  function refreshMyIncidents() {
    api
      .getIncidents({ limit: 2000 })
      .then((rows) => {
        setLayers((prev) => ({
          ...prev,
          "my-incidents": { data: rows.map(incidentRowToPoint).filter((p): p is GlobePoint => p !== null), loading: false, error: null },
        }));
      })
      .catch(() => {});
    if (Object.values(incidentFilters).some(Boolean)) {
      api.getIncidents({ ...incidentFilters, limit: 2000 }).then(setIncidentSearchResults).catch(() => {});
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
  // those in between). The map view is capped at 2000 rendered points for
  // performance; export (below) is never capped.
  useEffect(() => {
    const hasFilter = Object.values(incidentFilters).some(Boolean);
    if (!hasFilter) {
      setIncidentSearchResults(null);
      return;
    }
    let cancelled = false;
    setIncidentSearchLoading(true);
    api
      .getIncidents({ ...incidentFilters, limit: 2000 })
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
    } else if (activeTool === "shapes" && shapeDrawing) {
      setShapeDrawPoints((prev) => [...prev, [lat, lng]]);
    }
  }

  async function handleSaveShape() {
    if (shapeDrawPoints.length < 3) return;
    setShapeSaving(true);
    setShapeError(null);
    try {
      const ring = [...shapeDrawPoints, shapeDrawPoints[0]].map(([lat, lng]) => [lng, lat]);
      await api.createMapShape({
        name: shapeNameDraft.trim() || "Untitled AOI",
        source: "drawn",
        geometry: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
        style: { color: shapeColorDraft, fillColor: shapeColorDraft, fillOpacity: 0.22, weight: 2 },
      });
      setShapeDrawPoints([]);
      setShapeDrawing(false);
      setShapeNameDraft("");
      refreshShapes();
    } catch (err) {
      setShapeError(err instanceof Error ? err.message : "Couldn't save this AOI");
    } finally {
      setShapeSaving(false);
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
        color: "#4dff9e",
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
      if (def.key === "my-incidents" && incidentSearchResults) {
        all.push(...incidentSearchResults.map(incidentRowToPoint).filter((p): p is GlobePoint => p !== null));
        continue;
      }
      const data = layers[def.key]?.data;
      if (data) all.push(...data);
    }
    return all;
  }, [layers, enabled, incidentSearchResults]);

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
    if (activeTool === "shapes") {
      shapeDrawPoints.forEach(([lat, lng], i) => {
        extra.push({ id: `shape-${i}`, layerKey: "AOI", lat, lng, color: shapeColorDraft, size: 0.14, title: `Vertex ${i + 1}`, subtitle: "", time: null, url: null });
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
  }, [activeTool, issPos, routeOrigin, routeDestination, drawPoints, shapeDrawPoints, shapeColorDraft, listenResult]);

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

  const mapPoints = useMemo(() => [...points, ...toolPoints, ...listeningLayerPoints], [points, toolPoints, listeningLayerPoints]);

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
        ? [{ points: routeResult.coordinates.map(([lng, lat]) => [lat, lng] as LatLng), label: "Route", color: "#4dff9e" }]
        : [];
    const inProgressShape =
      activeTool === "shapes" && shapeDrawPoints.length >= 2
        ? [{ points: [...shapeDrawPoints, shapeDrawPoints[0]], label: shapeNameDraft || "New AOI", color: shapeColorDraft }]
        : [];
    const shapeOverlays = savedShapes
      .filter((s) => s.visible)
      .map((s) => ({ points: shapeRingLatLng(s), label: s.name, color: s.style?.color || "#7dd3fc" }))
      .filter((p) => p.points.length >= 3);
    const routeOverlays = savedRoutes
      .filter((r) => r.visible)
      .map((r) => ({ points: r.geometry as LatLng[], label: r.name, color: r.color || "#4dff9e" }))
      .filter((p) => p.points.length >= 2);
    return [...lanes, ...cables, ...drawPath, ...routePath, ...inProgressShape, ...shapeOverlays, ...routeOverlays];
  }, [
    enabled["maritime-lines"],
    maritimeLanes,
    enabled["submarine-cables"],
    submarineCables,
    drawMode,
    drawPoints,
    routeResult,
    activeTool,
    shapeDrawPoints,
    shapeNameDraft,
    shapeColorDraft,
    savedShapes,
    savedRoutes,
  ]);

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
            onMapClick={activeTool === "draw" || activeTool === "route" || activeTool === "shapes" ? handleMapClick : undefined}
            drawMode={activeTool === "draw" ? drawMode : null}
            drawPoints={drawPoints}
            routeLine={activeTool === "route" ? routeLineForFlatMap : undefined}
            savedShapes={savedShapes}
            savedRoutes={savedRoutes}
            shapeDrawPoints={activeTool === "shapes" ? shapeDrawPoints : undefined}
            shapeDrawActive={activeTool === "shapes" && shapeDrawing}
            shapeDraftColor={shapeColorDraft}
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
        <GlobalStatusTicker />

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
              if (next !== "shapes") {
                setShapeDrawing(false);
                setShapeDrawPoints([]);
                setShapeError(null);
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
            savedRoutes={savedRoutes}
            routeNameDraft={routeNameDraft}
            onRouteNameDraftChange={setRouteNameDraft}
            routeSaving={routeSaving}
            onSaveRoute={handleSaveRoute}
            onToggleRoute={(id, visible) => api.updateMapRoute(id, { visible }).then(refreshRoutes).catch(() => {})}
            onDeleteRoute={(id) => api.deleteMapRoute(id).then(refreshRoutes).catch(() => {})}
          />
        )}
        {activeTool === "space" && <LiveSpacePanel pos={issPos} error={issError} />}
        {activeTool === "news" && <NewsFeedPanel items={newsItems} loading={newsLoading} error={newsError} />}
        {activeTool === "incidents" && (
          <IncidentsToolPanel
            filterOptions={incidentFilterOptions}
            draft={incidentFilterDraft}
            onDraftChange={setIncidentFilterDraft}
            appliedCount={Object.values(incidentFilters).filter(Boolean).length}
            resultCount={incidentSearchResults?.length ?? null}
            loading={incidentSearchLoading}
            onSearch={handleIncidentSearch}
            onClear={handleIncidentClearFilters}
            onAdd={() => setIncidentModalTab("add")}
            onBulkUpload={() => setIncidentModalTab("bulk")}
            onBulkDelete={handleBulkDeleteFilteredIncidents}
            bulkDeleting={incidentBulkDeleting}
            onExport={handleIncidentExport}
            exporting={incidentExporting}
          />
        )}
        {activeTool === "economy" && (
          <EconomicIndicatorsPanel data={econData} loading={econLoading} error={econError} sortKey={econSortKey} onSortKeyChange={setEconSortKey} />
        )}
        {activeTool === "listen" && (
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
        {activeTool === "shapes" && (
          <ShapesToolPanel
            drawing={shapeDrawing}
            points={shapeDrawPoints}
            name={shapeNameDraft}
            color={shapeColorDraft}
            saving={shapeSaving}
            error={shapeError}
            onToggleDrawing={() => {
              setShapeDrawing((v) => !v);
              setShapeDrawPoints([]);
            }}
            onNameChange={setShapeNameDraft}
            onColorChange={setShapeColorDraft}
            onClear={() => setShapeDrawPoints([])}
            onSave={handleSaveShape}
            savedShapes={savedShapes}
            onToggleShape={(id, visible) => api.updateMapShape(id, { visible }).then(refreshShapes).catch(() => {})}
            onDeleteShape={(id) => api.deleteMapShape(id).then(refreshShapes).catch(() => {})}
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
 *  imagery, matching what the three style buttons mean on OSIRIS itself. */
function FlatMap({
  mode,
  points,
  onMapClick,
  drawMode,
  drawPoints,
  routeLine,
  savedShapes,
  savedRoutes,
  shapeDrawPoints,
  shapeDrawActive,
  shapeDraftColor,
}: {
  mode: Exclude<MapMode, "3d">;
  points: GlobePoint[];
  /** Set only while Drawing Tools, Route, or Shapes is the active
   *  right-side tool — its presence is literally what makes a map click do
   *  something. */
  onMapClick?: (lat: number, lng: number) => void;
  drawMode?: DrawMode;
  drawPoints?: LatLng[];
  routeLine?: LatLng[];
  /** Persisted overlays (map_shapes/map_routes) — shown regardless of which
   *  right-side tool is open, same as the live data layers, so a saved AOI
   *  or route stays visible while browsing rather than only while its own
   *  tool panel happens to be open. */
  savedShapes?: SavedShape[];
  savedRoutes?: SavedRoute[];
  shapeDrawPoints?: LatLng[];
  shapeDrawActive?: boolean;
  shapeDraftColor?: string;
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
      {shapeDrawActive && shapeDrawPoints && shapeDrawPoints.length >= 3 && (
        <Polygon
          positions={shapeDrawPoints}
          pathOptions={{ color: shapeDraftColor ?? "#7dd3fc", fillColor: shapeDraftColor ?? "#7dd3fc", fillOpacity: 0.2, weight: 2, dashArray: "4 4" }}
        />
      )}
      {savedShapes
        ?.filter((s) => s.visible)
        .map((s) => {
          const ring = shapeRingLatLng(s);
          if (ring.length < 3) return null;
          const color = s.style?.color || "#7dd3fc";
          return (
            <Polygon key={s.id} positions={ring} pathOptions={{ color, fillColor: s.style?.fillColor || color, fillOpacity: s.style?.fillOpacity ?? 0.18, weight: s.style?.weight ?? 2 }}>
              <LeafletTooltip direction="center">{s.name}</LeafletTooltip>
            </Polygon>
          );
        })}
      {savedRoutes
        ?.filter((r) => r.visible)
        .map((r) => (
          <Polyline key={r.id} positions={r.geometry as LatLng[]} pathOptions={{ color: r.color || "#4dff9e", weight: 3 }}>
            <LeafletTooltip direction="center">{r.name}</LeafletTooltip>
          </Polyline>
        ))}
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
}) {
  const groupedRows = useMemo(() => GROUP_ORDER.map((group) => defs.filter((d) => d.group === group)).filter((rows) => rows.length > 0), [defs]);
  const pinnedListeningQueries = useMemo(() => listeningQueries.filter((q) => q.pinned), [listeningQueries]);

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
      {pinnedListeningQueries.length > 0 && (
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

/** Top-center HUD ticker — OSIRIS's own GlobalStatusBar shows an exchange
 *  open/closed row, a country-risk chip row, and a CVE count fed from
 *  /api/cyber-threats; its MarketsPanel/space-weather readout separately
 *  shows the Kp index. This is the same ticker concept, rebuilt on real,
 *  verified-licensed sources (see globalStatus.ts's file comment for
 *  exactly which OSIRIS pieces were dropped or replaced and why — Markets'
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

/** Right-side icon rail — the OSIRIS-style vertical strip of tool buttons,
 *  mirroring the left LayerPanel's visual language (same dark glass card,
 *  same border color) but icon-only + a short label, since this rail holds
 *  tools rather than a scrollable list of toggles. */
function RightToolRail({ active, onSelect }: { active: RightTool; onSelect: (tool: Exclude<RightTool, null>) => void }) {
  const tools: { key: Exclude<RightTool, null>; icon: LucideIcon; label: string }[] = [
    { key: "incidents", icon: ClipboardList, label: "Incidents" },
    { key: "shapes", icon: Hexagon, label: "AOI" },
    { key: "economy", icon: Landmark, label: "Economy" },
    { key: "listen", icon: Megaphone, label: "Listen" },
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
  savedRoutes,
  routeNameDraft,
  onRouteNameDraftChange,
  routeSaving,
  onSaveRoute,
  onToggleRoute,
  onDeleteRoute,
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
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
          <input
            value={routeNameDraft}
            onChange={(e) => onRouteNameDraftChange(e.target.value)}
            placeholder="Name this route…"
            style={hudInputStyle}
          />
          <ToolButton onClick={onSaveRoute}>{routeSaving ? "Saving…" : "Save route (overlays the map)"}</ToolButton>
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
  onSearch,
  onClear,
  onAdd,
  onBulkUpload,
  onBulkDelete,
  bulkDeleting,
  onExport,
  exporting,
}: {
  filterOptions: IncidentFilterOptions | null;
  draft: IncidentFilterState;
  onDraftChange: (f: IncidentFilterState) => void;
  appliedCount: number;
  resultCount: number | null;
  loading: boolean;
  onSearch: () => void;
  onClear: () => void;
  onAdd: () => void;
  onBulkUpload: () => void;
  onBulkDelete: () => void;
  bulkDeleting: boolean;
  onExport: (format: "xlsx" | "csv") => void;
  exporting: "xlsx" | "csv" | null;
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
          <input
            type="date"
            value={draft.from ?? ""}
            onChange={(e) => onDraftChange({ ...draft, from: e.target.value || undefined })}
            style={{ ...hudInputStyle, flex: 1 }}
          />
          <input
            type="date"
            value={draft.to ?? ""}
            onChange={(e) => onDraftChange({ ...draft, to: e.target.value || undefined })}
            style={{ ...hudInputStyle, flex: 1 }}
          />
        </div>

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
          ? `${(resultCount ?? 0).toLocaleString()} incident${resultCount === 1 ? "" : "s"} match — shown on the map (capped at 2,000 points on-screen; export has the full set)`
          : "Enable \"My Incidents\" (under My Data, left rail) to see every uploaded/logged incident on the map. Set filters above and press Search to narrow that down."}
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

/** Shapes tool — draw-and-save persisted AOI overlays (map_shapes). Draw
 *  mode reuses the same map-click plumbing as Drawing Tools/Route, just
 *  writing to its own point buffer so the three don't collide. */
function ShapesToolPanel({
  drawing,
  points,
  name,
  color,
  saving,
  error,
  onToggleDrawing,
  onNameChange,
  onColorChange,
  onClear,
  onSave,
  savedShapes,
  onToggleShape,
  onDeleteShape,
}: {
  drawing: boolean;
  points: LatLng[];
  name: string;
  color: string;
  saving: boolean;
  error: string | null;
  onToggleDrawing: () => void;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onClear: () => void;
  onSave: () => void;
  savedShapes: SavedShape[];
  onToggleShape: (id: string, visible: boolean) => void;
  onDeleteShape: (id: string) => void;
}) {
  return (
    <ToolPanelShell title="Areas of Interest">
      <ToolButton active={drawing} onClick={onToggleDrawing}>
        {drawing ? "Drawing… click map to add vertices" : "Draw new AOI"}
      </ToolButton>
      {drawing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: HUD.textSecondary }}>
            {points.length} vertex{points.length === 1 ? "" : "es"} placed. Needs at least 3.
          </div>
          <input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Name this area…" style={hudInputStyle} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)} style={{ width: 32, height: 26, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
            <span style={{ fontSize: 10, color: HUD.textMuted }}>Overlay color</span>
          </div>
          {error && <div style={{ fontSize: 11, color: HUD.alertRed }}>{error}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <ToolButton onClick={onClear}>Clear points</ToolButton>
            <ToolButton onClick={onSave}>{saving ? "Saving…" : "Save AOI"}</ToolButton>
          </div>
        </div>
      )}

      {savedShapes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted }}>
            Saved areas ({savedShapes.length})
          </div>
          {savedShapes.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <input type="checkbox" checked={s.visible} onChange={(e) => onToggleShape(s.id, e.target.checked)} />
              <span
                style={{ width: 9, height: 9, borderRadius: 2, background: s.style?.color || "#7dd3fc", flexShrink: 0 }}
              />
              <span style={{ flex: 1, color: HUD.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.name}>
                {s.name}
              </span>
              <button onClick={() => onDeleteShape(s.id)} title="Delete" style={iconOnlyBtnStyle}>
                <CloseGlyph size={11} color={HUD.textMuted} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToolPanelShell>
  );
}

/** Economy tool — World Bank indicators (CC-BY 4.0, see globalStatus.ts's
 *  comment for the license check) across Afrilens's African coverage set.
 *  Tabular rather than map markers — a country's GDP isn't a point on the
 *  globe — so this is a wider scrollable panel rather than the usual
 *  260px ToolPanelShell. */
function EconomicIndicatorsPanel({
  data,
  loading,
  error,
  sortKey,
  onSortKeyChange,
}: {
  data: EconomicIndicators | null;
  loading: boolean;
  error: string | null;
  sortKey: string;
  onSortKeyChange: (k: string) => void;
}) {
  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.countries].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av !== "number" && typeof bv !== "number") return 0;
      if (typeof av !== "number") return 1;
      if (typeof bv !== "number") return -1;
      return bv - av;
    });
    return sorted;
  }, [data, sortKey]);

  function formatValue(v: unknown, unit: string): string {
    if (typeof v !== "number") return "—";
    if (unit === "US$") return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
    if (unit === "%/yr" || unit === "% of GDP") return `${v.toFixed(1)}%`;
    return v.toLocaleString();
  }

  return (
    <div
      style={{
        ...glassPanel(),
        position: "absolute",
        top: 12,
        right: 76,
        zIndex: 500,
        width: 340,
        maxHeight: "calc(100% - 24px)",
        overflowY: "auto",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 }}>Economy</div>
      {loading && <div style={{ fontSize: 11, color: HUD.textMuted }}>Loading World Bank indicators…</div>}
      {error && <div style={{ fontSize: 11, color: HUD.alertRed }}>{error}</div>}
      {data && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {data.indicators.map((ind) => (
              <ToolButton key={ind.key} active={sortKey === ind.key} onClick={() => onSortKeyChange(ind.key)}>
                {ind.label}
              </ToolButton>
            ))}
          </div>
          <div style={{ fontSize: 10, color: HUD.textMuted }}>{data.source} · sorted by {data.indicators.find((i) => i.key === sortKey)?.label}</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((r) => {
              const indicator = data.indicators.find((i) => i.key === sortKey);
              return (
                <div
                  key={r.code}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, padding: "5px 0", borderBottom: "1px solid rgba(212,175,55,0.08)" }}
                >
                  <span style={{ color: HUD.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.name}</span>
                  <span style={{ color: HUD.textPrimary, fontWeight: 600, marginLeft: 8 }}>{formatValue(r[sortKey], indicator?.unit ?? "")}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
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

/** Social Listening tool — a Sprinklr-style query builder plus a Search tab
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
    <div
      style={{
        ...glassPanel(),
        position: "absolute",
        top: 12,
        right: 76,
        zIndex: 500,
        width: 400,
        maxHeight: "calc(100% - 24px)",
        overflowY: "auto",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: HUD.textPrimary, fontWeight: 700 }}>Social Listening</div>
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
  tab: "add" | "bulk";
  onTabChange: (t: "add" | "bulk") => void;
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
      <div style={{ ...glassPanel(), width: "min(820px, 100%)", padding: 20, background: "rgba(10,12,22,0.97)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <ToolButton active={tab === "add"} onClick={() => onTabChange("add")}>
              Add one
            </ToolButton>
            <ToolButton active={tab === "bulk"} onClick={() => onTabChange("bulk")}>
              Bulk upload
            </ToolButton>
          </div>
          <button onClick={onClose} title="Close" style={iconOnlyBtnStyle}>
            <CloseGlyph size={18} color={HUD.textSecondary} />
          </button>
        </div>
        <div style={{ color: "#111", background: "#fff", borderRadius: 8, padding: 16 }}>
          <Suspense fallback={<div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
            {tab === "add" ? <IncidentManualEntry onSaved={onSaved} /> : <IncidentUpload onUploaded={onSaved} />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
