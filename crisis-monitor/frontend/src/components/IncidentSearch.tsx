import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import * as XLSX from "xlsx";
import html2canvas from "html2canvas";
import { api, type IncidentFilters, type IncidentItem } from "../api";
import { BASEMAPS, type BasemapKey, classifyActor, incidentIcon, totalCasualties, HeatmapLayer } from "./IncidentsMap";

type ViewMode = "markers" | "heatmap";

/** Grabs the underlying Leaflet map's DOM container once it's mounted, so the
 *  PNG export can hand it to html2canvas — react-leaflet doesn't expose this
 *  as a plain prop, so a tiny child using useMap() is the standard way to get it. */
function MapContainerRefCapture({ onReady }: { onReady: (el: HTMLElement) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map.getContainer());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

export default function IncidentSearch() {
  const [filterOptions, setFilterOptions] = useState<IncidentFilters | null>(null);
  const [filters, setFilters] = useState<{
    country?: string;
    province?: string;
    sector?: string;
    actor?: string;
    tactic?: string;
    severity?: string;
    from?: string;
    to?: string;
  }>({});
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [basemap, setBasemap] = useState<BasemapKey>("osm");
  const [viewMode, setViewMode] = useState<ViewMode>("markers");
  const [heatWeighted, setHeatWeighted] = useState(false);

  useEffect(() => {
    api.getIncidentFilters().then(setFilterOptions).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .getIncidents(filters)
      .then(setIncidents)
      .finally(() => setLoading(false));
  }, [filters]);

  const geoIncidents = useMemo(() => incidents.filter((i) => i.latitude != null && i.longitude != null), [incidents]);

  const initialCenter = useMemo((): LatLngExpression => {
    if (geoIncidents.length === 0) return [1, 20];
    const avgLat = geoIncidents.reduce((s, i) => s + i.latitude!, 0) / geoIncidents.length;
    const avgLng = geoIncidents.reduce((s, i) => s + i.longitude!, 0) / geoIncidents.length;
    return [avgLat, avgLng];
  }, [geoIncidents]);

  const heatmapPoints = useMemo((): [number, number, number][] => {
    return geoIncidents.map((i) => [i.latitude!, i.longitude!, heatWeighted ? Math.max(1, totalCasualties(i)) : 1]);
  }, [geoIncidents, heatWeighted]);

  const hasFilters = Object.values(filters).some(Boolean);
  const mapContainerRef = useRef<HTMLElement | null>(null);
  const [downloadingPng, setDownloadingPng] = useState(false);

  function downloadExcel() {
    const rows = incidents.map((i) => ({
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
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Incidents");
    XLSX.writeFile(workbook, `incident_search_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function downloadPng() {
    if (!mapContainerRef.current) return;
    setDownloadingPng(true);
    try {
      // useCORS lets html2canvas read cross-origin tile images where the tile
      // server allows it; where it doesn't, the map markers/heatmap (drawn
      // locally, not loaded as cross-origin images) still capture fine — only
      // the base tiles themselves might come out blank on a server that
      // withholds CORS headers. This varies by basemap/tile provider and isn't
      // something we can guarantee from here.
      const canvas = await html2canvas(mapContainerRef.current, { useCORS: true, allowTaint: false, logging: false });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `incident_search_map_${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setDownloadingPng(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ width: 300, flexShrink: 0, borderRight: "1px solid var(--border-soft)", padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>CATEGORY</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filterOptions && (
              <>
                <FilterSelect label="Sector" value={filters.sector} options={filterOptions.sector} onChange={(v) => setFilters((f) => ({ ...f, sector: v }))} />
                <FilterSelect label="Actor" value={filters.actor} options={filterOptions.actor} onChange={(v) => setFilters((f) => ({ ...f, actor: v }))} />
                <FilterSelect label="Tactic" value={filters.tactic} options={filterOptions.tactic} onChange={(v) => setFilters((f) => ({ ...f, tactic: v }))} />
                <FilterSelect label="Severity" value={filters.severity} options={filterOptions.severity} onChange={(v) => setFilters((f) => ({ ...f, severity: v }))} />
              </>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>LOCATION</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filterOptions && (
              <>
                <FilterSelect label="Country" value={filters.country} options={filterOptions.country} onChange={(v) => setFilters((f) => ({ ...f, country: v }))} />
                <FilterSelect label="Province" value={filters.province} options={filterOptions.province} onChange={(v) => setFilters((f) => ({ ...f, province: v }))} />
              </>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>DATE OF OCCURRENCE</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="date" value={filters.from ?? ""} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))} style={dateInputStyle} />
            <input type="date" value={filters.to ?? ""} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))} style={dateInputStyle} />
          </div>
        </div>

        {hasFilters && (
          <button onClick={() => setFilters({})} style={clearFiltersBtnStyle}>
            Clear all filters
          </button>
        )}

        <div style={{ height: 1, background: "var(--border-soft)" }} />

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>VIEW AS</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setViewMode("markers")} style={chipStyle(viewMode === "markers")}>
              Icons
            </button>
            <button onClick={() => setViewMode("heatmap")} style={chipStyle(viewMode === "heatmap")}>
              Heatmap
            </button>
          </div>
          {viewMode === "heatmap" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              <input type="checkbox" checked={heatWeighted} onChange={(e) => setHeatWeighted(e.target.checked)} />
              Weight by casualties, not just count
            </label>
          )}
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>BASEMAP</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
              <button key={k} onClick={() => setBasemap(k)} style={chipStyle(basemap === k)}>
                {BASEMAPS[k].label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border-soft)" }} />

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>EXPORT DATA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button onClick={downloadExcel} disabled={incidents.length === 0} style={secondaryBtnStyle}>
              Export as Excel ({incidents.length.toLocaleString()} rows)
            </button>
            <button onClick={downloadPng} disabled={downloadingPng} style={secondaryBtnStyle}>
              {downloadingPng ? "Capturing…" : "Export map as PNG"}
            </button>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: "auto" }}>
          {loading ? "Searching…" : `${geoIncidents.length.toLocaleString()} incidents match`}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <MapContainer center={initialCenter} zoom={geoIncidents.length ? 6 : 2} style={{ width: "100%", height: "100%" }} scrollWheelZoom>
          <MapContainerRefCapture onReady={(el) => (mapContainerRef.current = el)} />
          <TileLayer url={BASEMAPS[basemap].url} attribution={BASEMAPS[basemap].attribution} maxZoom={19} />

          {viewMode === "heatmap" && <HeatmapLayer points={heatmapPoints} />}

          {viewMode === "markers" &&
            geoIncidents.map((i) => {
              const category = classifyActor(i.actor);
              return (
                <Marker key={i.id} position={[i.latitude!, i.longitude!]} icon={incidentIcon(category, true)}>
                  <Popup>
                    <div style={{ fontSize: 13, minWidth: 180 }}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>
                        {[i.city, i.province].filter(Boolean).join(", ") || i.precise_location || "Unknown location"}
                      </div>
                      <div style={{ color: "#666", marginBottom: 4 }}>{i.occurred_date || ""}</div>
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: category.color, fontWeight: 600 }}>{category.label}</span>
                        {[i.sector, i.tactic, i.actor].filter(Boolean).length > 0 && " · "}
                        {[i.sector, i.tactic, i.actor].filter(Boolean).join(" · ")}
                      </div>
                      {totalCasualties(i) > 0 && <div style={{ color: "#d1352b" }}>{totalCasualties(i)} civilian casualties</div>}
                      {i.details && <div style={{ marginTop: 4, color: "#444" }}>{i.details.slice(0, 200)}</div>}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
        </MapContainer>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (v: string | undefined) => void }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={selectStyle}>
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
    background: active ? "var(--signal-dim)" : "var(--panel)",
    color: "var(--text-primary)",
    cursor: "pointer",
    flex: 1,
    textAlign: "center",
  };
}

const selectStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text-primary)",
  width: "100%",
};

const dateInputStyle: React.CSSProperties = { ...selectStyle, flex: 1 };

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "7px 10px",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  cursor: "pointer",
  textAlign: "left",
};

const clearFiltersBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 10px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--critical)",
  cursor: "pointer",
};
