import { useEffect, useMemo, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api, type PublicDashboardData } from "../api";
import DashboardWidgetCard from "./DashboardWidgetCard";
import Logo from "./Logo";
import { VizProvider, useViz } from "./viz/context";
import { themeFor, themeStyle } from "./viz/themes";
import VizCard from "./viz/VizCard";
import "./viz/viz.css";

const ResponsiveGridLayout = WidthProvider(GridLayout);

export default function PublicDashboardView({ token }: { token: string }) {
  // "?embed=1": shown inside another page (a Regional Spotlight article), so
  // the page's own header and outer padding are left off — the article
  // supplies the title and caption.
  const embedded = useMemo(() => new URLSearchParams(window.location.search).get("embed") === "1", []);
  const [data, setData] = useState<PublicDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Counts the refreshes, so the visuals that fetch their own data refetch with the rest.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api
      .getPublicDashboard(token)
      .then(setData)
      .catch(() => setError("This dashboard link is invalid, private, or no longer shared."));

    // Live viewing: refresh the underlying data periodically so a link left
    // open on a screen stays current without anyone needing to reload it.
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
      api
        .getPublicDashboard(token)
        .then((d) => {
          setData(d);
          // The visuals each run their own query, and a query reads the whole table; a screen left open all day
          // should not spend the database's daily allowance, so they refresh every ten minutes rather than every one.
          if (ticks % 10 === 0) setRefreshKey((k) => k + 1);
        })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [token]);

  if (error) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, background: "var(--base)" }}>
        <Logo size={40} />
        <div style={{ fontSize: 14, color: "var(--text-muted)" }}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--base)" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading dashboard…</div>
      </div>
    );
  }

  // The look its owner chose applies to the whole page, header included.
  const theme = themeFor(data.theme);

  return (
    <div data-viz-theme={theme.key} style={{ minHeight: "100vh", background: "var(--base)", ...themeStyle(theme) }}>
      <div style={{ display: embedded ? "none" : "flex", alignItems: "center", gap: 10, padding: "16px 24px", borderBottom: "1px solid var(--border-soft)", background: "var(--panel)" }}>
        <Logo size={26} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{data.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            Live shared dashboard · updated {new Date(data.updated_at).toLocaleString()}
            {(data.date_range_from || data.date_range_to) && (
              <> · showing {data.date_range_from ?? "the start"} to {data.date_range_to ?? "now"}</>
            )}
          </div>
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: 999,
            color: "var(--signal)",
            background: "color-mix(in srgb, var(--signal) 14%, transparent)",
            border: "1px solid color-mix(in srgb, var(--signal) 40%, transparent)",
          }}
        >
          ● Live
        </span>
      </div>

      <div style={{ padding: embedded ? 8 : 24 }}>
        {data.widgets.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13.5 }}>This dashboard has no widgets yet.</div>
        ) : (
          <VizProvider mode="public" token={token} theme={theme} refreshKey={refreshKey}>
            <PublicSelections />
            <PublicWidgetGrid data={data} />
          </VizProvider>
        )}
      </div>
    </div>
  );
}

/** Renders widgets at the exact positions/sizes their owner set, via the same
 *  grid system the editors use — just non-interactive (no drag, no resize). */
function PublicWidgetGrid({ data }: { data: PublicDashboardData }) {
  const layout: Layout[] = useMemo(
    () =>
      data.widgets
        .filter((w) => w.layout)
        .map((w) => ({ i: w.id, x: w.layout!.x, y: w.layout!.y, w: w.layout!.w, h: w.layout!.h })),
    [data.widgets]
  );

  return (
    <ResponsiveGridLayout className="layout" layout={layout} cols={12} rowHeight={26} margin={[16, 16]} isDraggable={false} isResizable={false}>
      {data.widgets.map((w) => (
        <div key={w.id}>
          {w.type === "viz" ? (
            <VizCard widget={w} editable={false} />
          ) : (
            <DashboardWidgetCard widget={w} stats={data.stats} incidents={data.incidents} crosstabs={data.crosstabs} breakdowns={data.breakdowns} dailyBreakdowns={data.dailyBreakdowns} datasetSummaries={data.datasetSummaries} victimGroups={data.victimGroups} monthlyGroups={data.monthlyGroups} />
          )}
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}

/** What the viewer has picked on the visuals, with a way to clear it. */
function PublicSelections() {
  const { selections, select, clearAll } = useViz();
  if (selections.length === 0) return null;
  return (
    <div className="vz-strip" style={{ padding: "0 0 12px", border: "none" }}>
      <span>Filtered by</span>
      {selections.map((s) => (
        <button key={s.origin} type="button" className="vz-chip" style={{ maxWidth: 320 }} onClick={() => select(s.origin, null)} title="Click to clear">
          {s.label} ✕
        </button>
      ))}
      {selections.length > 1 && (
        <button type="button" className="vz-link" onClick={clearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
