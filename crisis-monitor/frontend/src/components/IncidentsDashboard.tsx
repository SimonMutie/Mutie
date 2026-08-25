import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { api, type IncidentFilters, type IncidentItem, type IncidentStats } from "../api";
import IncidentsMap from "./IncidentsMap";
import IncidentUpload from "./IncidentUpload";
import IncidentManualEntry from "./IncidentManualEntry";
import IncidentManageTable from "./IncidentManageTable";

const CHART_COLOR = "#0d9488";
const TOOLTIP_STYLE = { background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

type Tab = "manual" | "overview" | "map" | "upload" | "manage";

export default function IncidentsDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [filterOptions, setFilterOptions] = useState<IncidentFilters | null>(null);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [filters, setFilters] = useState<{ country?: string; province?: string; sector?: string; actor?: string; severity?: string }>({});
  const [loading, setLoading] = useState(true);
  const [manageRefreshKey, setManageRefreshKey] = useState(0);

  async function loadAll() {
    setLoading(true);
    const [statsRes, filtersRes, incidentsRes] = await Promise.all([
      api.getIncidentStats(),
      api.getIncidentFilters(),
      api.getIncidents(filters),
    ]);
    setStats(statsRes);
    setFilterOptions(filtersRes);
    setIncidents(incidentsRes);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const casualtyTotal = stats
    ? Object.entries(stats.casualties)
        .filter(([k]) => k.startsWith("deaths_") || k.startsWith("injuries_"))
        .reduce((sum, [, v]) => sum + (v ?? 0), 0)
    : 0;
  const deathTotal = stats
    ? Object.entries(stats.casualties)
        .filter(([k]) => k.startsWith("deaths_"))
        .reduce((sum, [, v]) => sum + (v ?? 0), 0)
    : 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginRight: 12 }}>Incidents</div>
        {(["manual", "overview", "map", "manage", "upload"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtnStyle(tab === t)}>
            {t === "manual" ? "Enter Manually" : t === "overview" ? "Overview" : t === "map" ? "Map" : t === "manage" ? "Manage" : "Upload"}
          </button>
        ))}
        {stats && <div style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--text-muted)" }}>{stats.total.toLocaleString()} incidents total</div>}
      </div>

      {tab === "manual" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <IncidentManualEntry
            onSaved={() => {
              loadAll();
              setManageRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {tab === "manage" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <IncidentManageTable
            refreshKey={manageRefreshKey}
            onChanged={() => {
              loadAll();
              setManageRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {tab === "upload" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <IncidentUpload
            onUploaded={() => {
              loadAll();
              setManageRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {tab === "map" && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <IncidentsMap incidents={incidents} />
        </div>
      )}

      {tab === "overview" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          {filterOptions && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <FilterSelect
                label="Country"
                value={filters.country}
                options={filterOptions.country}
                onChange={(v) => setFilters((f) => ({ ...f, country: v }))}
              />
              <FilterSelect
                label="Province"
                value={filters.province}
                options={filterOptions.province}
                onChange={(v) => setFilters((f) => ({ ...f, province: v }))}
              />
              <FilterSelect
                label="Sector"
                value={filters.sector}
                options={filterOptions.sector}
                onChange={(v) => setFilters((f) => ({ ...f, sector: v }))}
              />
              <FilterSelect
                label="Actor"
                value={filters.actor}
                options={filterOptions.actor}
                onChange={(v) => setFilters((f) => ({ ...f, actor: v }))}
              />
              <FilterSelect
                label="Severity"
                value={filters.severity}
                options={filterOptions.severity}
                onChange={(v) => setFilters((f) => ({ ...f, severity: v }))}
              />
              {Object.values(filters).some(Boolean) && (
                <button onClick={() => setFilters({})} style={{ ...tabBtnStyle(false), color: "var(--critical)" }}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {loading && !stats ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
          ) : stats ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <SummaryCard label="Total incidents" value={stats.total.toLocaleString()} />
                <SummaryCard label="Civilian deaths" value={deathTotal.toLocaleString()} color="var(--critical)" />
                <SummaryCard label="Civilian injuries + deaths" value={casualtyTotal.toLocaleString()} color="var(--elevated)" />
                <SummaryCard label="NGO kidnappings" value={(stats.casualties.kidnappings_ngo ?? 0).toLocaleString()} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <ChartPanel title="INCIDENTS BY SECTOR">
                  <BarChart data={stats.by_sector} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <YAxis type="category" dataKey="value" width={110} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" fill={CHART_COLOR} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartPanel>

                <ChartPanel title="INCIDENTS BY ACTOR">
                  <BarChart data={stats.by_actor} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <YAxis type="category" dataKey="value" width={110} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" fill="#2f66f0" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartPanel>

                <ChartPanel title="INCIDENTS BY TACTIC">
                  <BarChart data={stats.by_tactic} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <YAxis type="category" dataKey="value" width={110} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" fill="#b3690b" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartPanel>

                <ChartPanel title="INCIDENTS BY PROVINCE">
                  <BarChart data={stats.by_province} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <YAxis type="category" dataKey="value" width={110} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" fill="#d1352b" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartPanel>

                <ChartPanel title="INCIDENTS BY COUNTRY">
                  <BarChart data={stats.by_country} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <YAxis type="category" dataKey="value" width={110} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" fill="#7c3aed" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartPanel>
              </div>

              <ChartPanel title="INCIDENTS OVER TIME (BY MONTH)" height={220}>
                <LineChart data={stats.time_series} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="count" stroke={CHART_COLOR} strokeWidth={2} dot={false} />
                </LineChart>
              </ChartPanel>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function ChartPanel({ title, children, height = 260 }: { title: string; children: React.ReactElement; height?: number }) {
  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{title}</div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options: string[];
  onChange: (v: string | undefined) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={{
        fontSize: 12.5,
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        color: value ? "var(--text-primary)" : "var(--text-muted)",
      }}
    >
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12.5,
    padding: "6px 12px",
    background: active ? "var(--signal-dim)" : "transparent",
    border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
    borderRadius: 6,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
  };
}
