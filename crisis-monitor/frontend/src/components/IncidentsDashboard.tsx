import { useEffect, useMemo, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api, type PublicDashboardData } from "../api";
import DashboardWidgetCard from "./DashboardWidgetCard";
import Logo from "./Logo";

const ResponsiveGridLayout = WidthProvider(GridLayout);

export default function PublicDashboardView({ token }: { token: string }) {
  const [data, setData] = useState<PublicDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPublicDashboard(token)
      .then(setData)
      .catch(() => setError("This dashboard link is invalid, private, or no longer shared."));

    // Live viewing: refresh the underlying data periodically so a link left
    // open on a screen stays current without anyone needing to reload it.
    const interval = setInterval(() => {
      api.getPublicDashboard(token).then(setData).catch(() => {});
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

  return (
    <div style={{ minHeight: "100vh", background: "var(--base)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 24px", borderBottom: "1px solid var(--border-soft)", background: "var(--panel)" }}>
        <Logo size={26} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{data.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            Live shared dashboard · updated {new Date(data.updated_at).toLocaleString()}
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

      <div style={{ padding: 24 }}>
        {data.widgets.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13.5 }}>This dashboard has no widgets yet.</div>
        ) : (
          <PublicWidgetGrid data={data} />
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
          <DashboardWidgetCard widget={w} stats={data.stats} incidents={data.incidents} />
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
