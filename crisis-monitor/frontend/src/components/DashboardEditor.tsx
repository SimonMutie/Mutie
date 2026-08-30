import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api, ApiError, type CrosstabRow, type Dataset, type DatasetSummary, type DashboardWidget, type IncidentFilters, type IncidentItem, type IncidentStats, type NormalizedDashboardStats, type PivotableField, type WidgetDataField, type WidgetType } from "../api";
import DashboardWidgetCard, { breakdownKeyFor, crosstabKeyFor, dailyKeyFor, DATA_FIELD_TO_COLUMN, fieldLabel, PRESET_THEMES, COLOR_SWATCHES, FIELDS_FOR_TYPE, WIDGET_TYPES, PIVOTABLE_FIELD_OPTIONS, PIVOT_FIELD_LABELS } from "./DashboardWidgetCard";
import ErrorBoundary from "./ErrorBoundary";

const ResponsiveGridLayout = WidthProvider(GridLayout);
const SIZE_DEFAULTS: Record<DashboardWidget["size"], { w: number; h: number }> = {
  small: { w: 3, h: 4 },
  medium: { w: 6, h: 8 },
  large: { w: 12, h: 9 },
};
const GRID_COLS = 12;

/** IncidentStats (the existing authenticated stats endpoint) has casualties
 *  broken into several named fields; widgets want three flat numbers. This
 *  keeps every editor using the exact same widget-rendering code as the
 *  public share view, which gets an already-normalized shape from the backend. */
function normalizeStats(stats: IncidentStats): NormalizedDashboardStats {
  const deaths = Object.entries(stats.casualties)
    .filter(([k]) => k.startsWith("deaths_"))
    .reduce((sum, [, v]) => sum + (v ?? 0), 0);
  const injuries = Object.entries(stats.casualties)
    .filter(([k]) => k.startsWith("injuries_"))
    .reduce((sum, [, v]) => sum + (v ?? 0), 0);
  return {
    total: stats.total,
    by_sector: stats.by_sector,
    by_actor: stats.by_actor,
    by_tactic: stats.by_tactic,
    by_severity: stats.by_severity,
    by_province: stats.by_province,
    by_country: stats.by_country,
    time_series: stats.time_series,
    daily: stats.daily,
    actor_tactic: stats.actor_tactic,
    deaths,
    injuries,
    kidnappings_ngo: stats.casualties.kidnappings_ngo ?? 0,
  };
}

/** Widgets from before real grid layout existed (or ones missing a saved
 *  position for any other reason) get auto-placed in a simple left-to-right,
 *  wrapping flow so nothing overlaps on first render. */
function ensureLayouts(widgets: DashboardWidget[]): DashboardWidget[] {
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  return widgets.map((w) => {
    if (w.layout) {
      cursorY = Math.max(cursorY, w.layout.y + w.layout.h);
      return w;
    }
    const { w: itemW, h: itemH } = SIZE_DEFAULTS[w.size] ?? SIZE_DEFAULTS.medium;
    if (cursorX + itemW > GRID_COLS) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    const layoutBox = { x: cursorX, y: cursorY, w: itemW, h: itemH };
    cursorX += itemW;
    rowH = Math.max(rowH, itemH);
    return { ...w, layout: layoutBox };
  });
}

type Mode = { kind: "bespoke"; id: string | null } | { kind: "auto" };

interface Props {
  mode: Mode;
  onBack?: () => void;
  onSavedNew?: (id: string) => void;
}

export default function DashboardEditor({ mode, onBack, onSavedNew }: Props) {
  const [name, setName] = useState(mode.kind === "auto" ? "Auto Dashboard" : "Untitled dashboard");
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [backendId, setBackendId] = useState<string | null>(mode.kind === "bespoke" ? mode.id : null);
  const [isPublic, setIsPublic] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [dateRangeFrom, setDateRangeFrom] = useState<string | undefined>(undefined);
  const [dateRangeTo, setDateRangeTo] = useState<string | undefined>(undefined);
  // Session-scoped, not persisted with the dashboard the way date range is —
  // date range already has a saved column on the dashboard record; giving
  // these the same treatment would need a schema change for what's
  // intentionally a lighter-weight, exploratory "let me look at this slice
  // right now" filter rather than a fixed dashboard setting.
  const [categoryFilters, setCategoryFilters] = useState<Partial<Record<PivotableField, string>>>({});
  // Hovering a bar/slice temporarily overlays one field's value on top of
  // the persistent filters above, live only while the mouse is actually
  // over it — a preview, not something that sticks around or gets
  // remembered. Debounced on entry (150ms) since mouseenter fires on every
  // single bar as the cursor sweeps across a chart; without that, moving
  // the mouse across ten bars would fire ten full-dashboard refetches in
  // well under a second. No debounce on leaving — that should revert
  // immediately, not lag behind the mouse.
  const [hoverCrossFilter, setHoverCrossFilter] = useState<{ field: PivotableField; value: string } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleCrossFilterHoverStart(field: PivotableField, value: string) {
    // Cancels whatever was pending — including a leave from the previously
    // hovered bar — so quickly sweeping across several bars only ever
    // settles on wherever the mouse actually stops, rather than firing a
    // refetch for every bar swept past along the way.
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverCrossFilter({ field, value }), 150);
  }
  function handleCrossFilterHoverEnd() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverCrossFilter(null), 100);
  }
  // Clicking pins a filter persistently — into categoryFilters itself, not
  // the temporary hover overlay — so it survives after the mouse moves
  // away, the same way a filter set via the Filter popover would. Clicking
  // the same value again un-pins it. Also clears any live hover preview for
  // that same field, since the click just made it redundant — the pinned
  // value and the (identical) hovered value would otherwise both be "in
  // effect" at once for no reason.
  function handleCrossFilterClick(field: PivotableField, value: string) {
    setCategoryFilters((f) => (f[field] === value ? { ...f, [field]: undefined } : { ...f, [field]: value }));
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverCrossFilter(null);
  }
  // What every widget's data should actually be fetched/filtered by — the
  // persistent filters with the live hover value (if any) layered on top
  // for that one field. The Filter popover itself still reads and edits
  // categoryFilters directly, not this — the hover preview shouldn't leak
  // into what looks like a saved, deliberate filter choice.
  const effectiveFilters = useMemo(
    () => (hoverCrossFilter ? { ...categoryFilters, [hoverCrossFilter.field]: hoverCrossFilter.value } : categoryFilters),
    [categoryFilters, hoverCrossFilter]
  );
  const [filterOptions, setFilterOptions] = useState<IncidentFilters | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [stats, setStats] = useState<NormalizedDashboardStats | null>(null);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErrorDetail, setSaveErrorDetail] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Loading existing data fires this same "widgets changed" effect once on
  // arrival (setWidgets from the fetch), which isn't a real edit and
  // shouldn't trigger a pointless immediate re-save — but a brand new,
  // never-saved dashboard has no such load to skip past, so its very first
  // widget needs to autosave right away rather than have that one change
  // silently consumed as the "skip".
  const skipNextAutoSave = useRef(!(mode.kind === "bespoke" && mode.id === null));
  const [addingWidget, setAddingWidget] = useState(false);
  const [draftType, setDraftType] = useState<WidgetType>("bar");
  const [draftField, setDraftField] = useState<WidgetDataField>("by_sector");
  const [draftSize, setDraftSize] = useState<DashboardWidget["size"]>("medium");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDataLabels, setDraftDataLabels] = useState(false);
  const [draftColor, setDraftColor] = useState<string | undefined>(undefined);
  const [draftPalette, setDraftPalette] = useState<string[]>([]);
  const [draftLegend, setDraftLegend] = useState(false);
  const [draftTopN, setDraftTopN] = useState<number | undefined>(undefined);
  const [draftSecondaryField, setDraftSecondaryField] = useState<PivotableField | undefined>(undefined);
  const [linkCopied, setLinkCopied] = useState(false);
  const [crosstabs, setCrosstabs] = useState<Record<string, CrosstabRow[]>>({});
  const [breakdowns, setBreakdowns] = useState<Record<string, { value: string; count: number }[]>>({});
  const [dailyBreakdowns, setDailyBreakdowns] = useState<Record<string, { date: string; count: number }[]>>({});
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetSummaries, setDatasetSummaries] = useState<Record<string, DatasetSummary>>({});

  useEffect(() => {
    api.getDatasets().then(setDatasets);
    api.getIncidentFilters().then(setFilterOptions).catch(() => {});
  }, []);

  useEffect(() => {
    api.getIncidentStats({ from: dateRangeFrom, to: dateRangeTo, ...effectiveFilters }).then((s) => setStats(normalizeStats(s)));
    api.getIncidents({ limit: 3000, from: dateRangeFrom, to: dateRangeTo, ...effectiveFilters }).then(setIncidents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeFrom, dateRangeTo, JSON.stringify(effectiveFilters)]);

  // A changed date range or category filter invalidates every previously-
  // fetched breakdown and crosstab (they were computed under the old
  // filters) — clearing them lets the fetch effects below, which only fetch
  // keys they don't already have, naturally treat everything as needing a
  // fresh fetch.
  useEffect(() => {
    setBreakdowns({});
    setCrosstabs({});
    setDailyBreakdowns({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeFrom, dateRangeTo, JSON.stringify(effectiveFilters)]);

  // Fetches only the specific (primary, secondary) cross-tabs the current set
  // of widgets actually need, and only the ones not already fetched — adding
  // a "Break down by" field to one widget shouldn't re-fetch data every other
  // widget already has. A "ds:<id>:<primary>|<secondary>" key (see
  // crosstabKeyFor) routes to that dataset's own crosstab endpoint instead of
  // the incidents one — same idea, different table underneath.
  useEffect(() => {
    const neededKeys = new Set<string>();
    for (const w of widgets) {
      const key = crosstabKeyFor(w);
      if (key) neededKeys.add(key);
    }
    const missing = Array.from(neededKeys).filter((k) => !(k in crosstabs));
    if (missing.length === 0) return;
    missing.forEach((key) => {
      if (key.startsWith("ds:")) {
        const rest = key.slice(3);
        const idEnd = rest.indexOf(":");
        const datasetId = rest.slice(0, idEnd);
        const fields = rest.slice(idEnd + 1);
        const sepIdx = fields.indexOf("|");
        const primary = fields.slice(0, sepIdx);
        const secondary = fields.slice(sepIdx + 1);
        api.getDatasetCrosstab(datasetId, primary, secondary).then((rows) => {
          setCrosstabs((prev) => ({ ...prev, [key]: rows }));
        });
        return;
      }
      const [primary, secondary] = key.split("|") as [PivotableField, PivotableField];
      api.getCrosstab(primary, secondary, { from: dateRangeFrom, to: dateRangeTo, ...effectiveFilters }).then((rows) => {
        setCrosstabs((prev) => ({ ...prev, [key]: rows }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, dateRangeFrom, dateRangeTo, JSON.stringify(effectiveFilters)]);

  // Same idea, one dimension instead of two — for widgets whose primary
  // field is one of the newer by_X fields not precomputed on stats, or any
  // dataset-sourced field at all (a dataset never has anything precomputed).
  useEffect(() => {
    const neededFields = new Set<string>();
    for (const w of widgets) {
      const field = breakdownKeyFor(w);
      if (field) neededFields.add(field);
    }
    const missing = Array.from(neededFields).filter((f) => !(f in breakdowns));
    if (missing.length === 0) return;
    missing.forEach((field) => {
      if (field.startsWith("ds:")) {
        const rest = field.slice(3);
        const idEnd = rest.indexOf(":");
        const datasetId = rest.slice(0, idEnd);
        const column = rest.slice(idEnd + 1);
        api.getDatasetBreakdown(datasetId, column).then((rows) => {
          setBreakdowns((prev) => ({ ...prev, [field]: rows }));
        });
        return;
      }
      api.getBreakdown(field as PivotableField, { from: dateRangeFrom, to: dateRangeTo, ...effectiveFilters }).then((rows) => {
        setBreakdowns((prev) => ({ ...prev, [field]: rows }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, dateRangeFrom, dateRangeTo, JSON.stringify(effectiveFilters)]);

  // Stat cards sourced from a dataset need that dataset's row count / column
  // sums — fetched once per dataset actually in use, not once per widget.
  useEffect(() => {
    const neededDatasetIds = new Set<string>();
    for (const w of widgets) {
      if (w.type === "stat" && w.datasetId) neededDatasetIds.add(w.datasetId);
    }
    const missing = Array.from(neededDatasetIds).filter((id) => !(id in datasetSummaries));
    if (missing.length === 0) return;
    missing.forEach((id) => {
      api.getDatasetSummary(id).then((summary) => {
        setDatasetSummaries((prev) => ({ ...prev, [id]: summary }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets]);

  // Calendar widgets sourced from a dataset need that dataset's day-level
  // counts for whichever date column was picked — incidents' own calendar
  // reads stats.daily directly and never reaches this.
  useEffect(() => {
    const neededKeys = new Set<string>();
    for (const w of widgets) {
      const key = dailyKeyFor(w);
      if (key) neededKeys.add(key);
    }
    const missing = Array.from(neededKeys).filter((k) => !(k in dailyBreakdowns));
    if (missing.length === 0) return;
    missing.forEach((key) => {
      const rest = key.slice(3);
      const idEnd = rest.indexOf(":");
      const datasetId = rest.slice(0, idEnd);
      const column = rest.slice(idEnd + 1);
      api.getDatasetDaily(datasetId, column).then((rows) => {
        setDailyBreakdowns((prev) => ({ ...prev, [key]: rows }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets]);

  useEffect(() => {
    setLoaded(false);
    const load = mode.kind === "auto" ? api.getOrCreateAutoDashboard() : mode.id ? api.getCustomDashboard(mode.id) : null;
    if (!load) {
      setLoaded(true);
      return;
    }
    load.then((d) => {
      setName(d.name);
      setWidgets(ensureLayouts(d.widgets));
      setBackendId(d.id);
      setIsPublic(d.is_public);
      setShareToken(d.share_token);
      setLocked(d.locked);
      setDateRangeFrom(d.date_range_from ?? undefined);
      setDateRangeTo(d.date_range_to ?? undefined);
      setLoaded(true);
      skipNextAutoSave.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, mode.kind === "bespoke" ? mode.id : null]);

  const layout: Layout[] = useMemo(
    () =>
      widgets
        .filter((w) => w.layout)
        .map((w) => ({ i: w.id, x: w.layout!.x, y: w.layout!.y, w: w.layout!.w, h: w.layout!.h, static: locked || !!w.locked })),
    [widgets, locked]
  );

  function handleLayoutChange(next: Layout[]) {
    setWidgets((ws) =>
      ws.map((w) => {
        const item = next.find((l) => l.i === w.id);
        return item ? { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : w;
      })
    );
  }

  function addWidget() {
    const { w: itemW, h: itemH } = SIZE_DEFAULTS[draftSize];
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.layout?.y ?? 0) + (w.layout?.h ?? 0)), 0);
    const supportsBreakdown = draftType === "bar" || draftType === "line";
    const widget: DashboardWidget = {
      id: crypto.randomUUID(),
      type: draftType,
      title: `${draftType === "stat" ? "" : `${draftType[0].toUpperCase()}${draftType.slice(1)}: `}${fieldLabel(draftField)}`,
      label: draftLabel || undefined,
      dataField: draftType === "map" ? undefined : draftField,
      secondaryField: supportsBreakdown ? draftSecondaryField : undefined,
      size: draftSize,
      showDataLabels: draftDataLabels,
      color: draftColor,
      palette: draftPalette.length > 0 ? draftPalette : undefined,
      showLegend: draftLegend,
      topN: draftTopN,
      layout: { x: 0, y: maxY, w: itemW, h: itemH },
    };
    setWidgets((w) => [...w, widget]);
    resetDraft();
  }

  function resetDraft() {
    setAddingWidget(false);
    setDraftType("bar");
    setDraftField("by_sector");
    setDraftSize("medium");
    setDraftLabel("");
    setDraftDataLabels(false);
    setDraftColor(undefined);
    setDraftPalette([]);
    setDraftLegend(false);
    setDraftTopN(undefined);
    setDraftSecondaryField(undefined);
  }

  function updateWidget(id: string, patch: Partial<DashboardWidget>) {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  function removeWidget(id: string) {
    setWidgets((w) => w.filter((x) => x.id !== id));
  }
  function renameWidget(id: string, title: string) {
    setWidgets((w) => w.map((x) => (x.id === id ? { ...x, title } : x)));
  }

  async function save() {
    setSaveStatus("saving");
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      if (backendId) {
        await api.updateCustomDashboard(backendId, { name, widgets });
      } else {
        const created = await api.createCustomDashboard(name, widgets);
        setBackendId(created.id);
        onSavedNew?.(created.id);
      }
      setSaveStatus("saved");
      setSaveErrorDetail(null);
      setDirty(false);
    } catch (err) {
      // Surfaced, not swallowed — a silent failure here is exactly what made
      // edits look saved (the widget itself updates instantly either way)
      // while nothing had actually reached the server. The specific message
      // (not just "it failed") is what makes this actually diagnosable
      // in-app instead of needing DevTools every time.
      setSaveStatus("error");
      setSaveErrorDetail(err instanceof ApiError ? err.message : "Couldn't reach the server. Check your connection and try again.");
    }
  }

  // Every edit — dragging, resizing, adding/removing/renaming a widget, or
  // changing a widget's settings in its popover — updates `widgets` here,
  // which now saves itself a beat later. There is no separate "did you
  // remember to click Save" step for this to fail silently against; the
  // manual Save button below still exists for an immediate, explicit save,
  // but it's a convenience, not a requirement.
  useEffect(() => {
    if (!loaded || locked) return;
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false;
      return;
    }
    setSaveStatus("idle");
    setDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      save();
    }, 900);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, name, loaded, locked]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Covers closing the tab, refreshing, or typing a new URL — anything
  // that isn't a click inside this app (that's handled separately by
  // guardedBack below, since beforeunload can't intercept in-app navigation).
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  function guardedBack() {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onBack?.();
  }

  async function toggleShare() {
    if (!backendId) await save();
    if (!backendId) return;
    const updated = await api.updateCustomDashboard(backendId, { is_public: !isPublic });
    setIsPublic(updated.is_public);
    setShareToken(updated.share_token);
  }

  function copyShareLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/shared/${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  async function toggleLock() {
    if (!locked) {
      // Locking is "I'm done editing" — make sure what gets locked is
      // actually what's on screen, not a stale saved copy from before the
      // last drag/resize/edit.
      await save();
    }
    if (!backendId) return;
    const updated = await api.updateCustomDashboard(backendId, { locked: !locked });
    setLocked(updated.locked);
  }

  /** Persists immediately rather than waiting for the debounced auto-save —
   *  a date range is exactly the kind of setting where "I picked a date and
   *  nothing visibly happened yet" would be confusing, and every widget's
   *  data already refetches the moment local state changes regardless. */
  async function updateDateRange(from: string | undefined, to: string | undefined) {
    setDateRangeFrom(from);
    setDateRangeTo(to);
    if (!backendId) return;
    await api.updateCustomDashboard(backendId, { date_range_from: from ?? null, date_range_to: to ?? null });
  }

  const filterPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterPanelOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) setFilterPanelOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [filterPanelOpen]);

  const activeFilterCount = (dateRangeFrom ? 1 : 0) + (dateRangeTo ? 1 : 0) + Object.values(categoryFilters).filter(Boolean).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 24px", borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap" }}>
        {onBack && (
          <button onClick={guardedBack} style={secondaryBtnStyle}>
            ← All dashboards
          </button>
        )}
        {locked ? (
          <div style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 160, display: "flex", alignItems: "center", gap: 6 }}>
            🔒 {name}
          </div>
        ) : (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ fontSize: 15, fontWeight: 700, border: "none", background: "transparent", color: "var(--text-primary)", flex: 1, minWidth: 160 }}
          />
        )}
        {!locked && (
          <div ref={filterPanelRef} style={{ position: "relative" }}>
            <button
              onClick={() => setFilterPanelOpen((v) => !v)}
              style={{
                ...secondaryBtnStyle,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: filterPanelOpen || activeFilterCount > 0 ? "var(--signal-dim)" : undefined,
                borderColor: filterPanelOpen || activeFilterCount > 0 ? "var(--signal)" : undefined,
              }}
            >
              Filter
              {activeFilterCount > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    borderRadius: 999,
                    background: "var(--signal)",
                    color: "var(--panel)",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {activeFilterCount}
                </span>
              )}
            </button>

            {filterPanelOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  zIndex: 1000,
                  width: 320,
                  maxHeight: "70vh",
                  overflowY: "auto",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 14,
                  boxShadow: "0 8px 24px rgba(19,23,34,0.18)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                  Only affects Incidents-sourced widgets — dataset-sourced widgets have no matching columns to filter by.
                </div>

                <div>
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6, opacity: 0.7 }}>DATE OF OCCURRENCE</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="date"
                      value={dateRangeFrom ?? ""}
                      onChange={(e) => updateDateRange(e.target.value || undefined, dateRangeTo)}
                      style={{ ...secondaryBtnStyle, flex: 1, padding: "6px 8px", fontSize: 12 }}
                    />
                    <input
                      type="date"
                      value={dateRangeTo ?? ""}
                      onChange={(e) => updateDateRange(dateRangeFrom, e.target.value || undefined)}
                      style={{ ...secondaryBtnStyle, flex: 1, padding: "6px 8px", fontSize: 12 }}
                    />
                  </div>
                </div>

                {filterOptions && (
                  <>
                    <div>
                      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6, opacity: 0.7 }}>LOCATION</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(["country", "province", "county", "district", "city", "suburb"] as const).map((field) => (
                          <DashboardFilterSelect
                            key={field}
                            label={PIVOT_FIELD_LABELS[field] ?? field}
                            value={categoryFilters[field]}
                            options={filterOptions[field]}
                            onChange={(v) => setCategoryFilters((f) => ({ ...f, [field]: v }))}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6, opacity: 0.7 }}>CATEGORY</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(
                          ["sector", "actor", "tactic", "severity", "operation", "target", "interest_group", "actual_main_victim", "intended_primary_target"] as const
                        ).map((field) => (
                          <DashboardFilterSelect
                            key={field}
                            label={PIVOT_FIELD_LABELS[field] ?? field}
                            value={categoryFilters[field]}
                            options={filterOptions[field]}
                            onChange={(v) => setCategoryFilters((f) => ({ ...f, [field]: v }))}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div style={{ display: "flex", gap: 6 }}>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={() => {
                        updateDateRange(undefined, undefined);
                        setCategoryFilters({});
                      }}
                      style={{ ...secondaryBtnStyle, flex: 1 }}
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    onClick={() => setFilterPanelOpen(false)}
                    style={{ ...secondaryBtnStyle, flex: 1, background: "var(--signal-dim)", borderColor: "var(--signal)", fontWeight: 600 }}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!locked && (
          <button
            onClick={() => {
              resetDraft();
              setAddingWidget(true);
            }}
            style={primaryBtnStyle}
          >
            + Add widget
          </button>
        )}
        {!locked && (
          <button onClick={save} disabled={saveStatus === "saving"} style={primaryBtnStyle}>
            Save
          </button>
        )}
        {!locked && <SaveStatusIndicator status={saveStatus} errorDetail={saveErrorDetail} onRetry={save} />}
        <button onClick={toggleLock} title={locked ? "Unlock to edit again" : "Lock once you're done editing, to prevent accidental changes"} style={locked ? liveBtnStyle : secondaryBtnStyle}>
          {locked ? "🔒 Locked — click to unlock" : "🔓 Lock dashboard"}
        </button>
        {!locked && (
          <button onClick={toggleShare} style={isPublic ? liveBtnStyle : secondaryBtnStyle}>
            {isPublic ? "● Live shared" : "Share for live viewing"}
          </button>
        )}
        {isPublic && shareToken && (
          <button onClick={copyShareLink} style={secondaryBtnStyle}>
            {linkCopied ? "Copied!" : "Copy link"}
          </button>
        )}
      </div>

      {addingWidget && (
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border-soft)", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", background: "var(--panel-raised)" }}>
          <div className="eyebrow" style={{ width: "100%", marginBottom: -4 }}>NEW WIDGET</div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>TYPE</div>
            <select
              value={draftType}
              onChange={(e) => {
                const newType = e.target.value as WidgetType;
                setDraftType(newType);
                if (FIELDS_FOR_TYPE[newType].length > 0 && !FIELDS_FOR_TYPE[newType].includes(draftField)) {
                  setDraftField(FIELDS_FOR_TYPE[newType][0]);
                }
              }}
              style={selectStyle}
            >
              {WIDGET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {draftType !== "map" && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>DATA</div>
              <select value={draftField} onChange={(e) => setDraftField(e.target.value as WidgetDataField)} style={selectStyle}>
                {FIELDS_FOR_TYPE[draftType].map((f) => (
                  <option key={f} value={f}>
                    {fieldLabel(f)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(draftType === "bar" || draftType === "line") && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>BREAK DOWN BY (OPTIONAL)</div>
              <select
                value={draftSecondaryField ?? ""}
                onChange={(e) => setDraftSecondaryField(e.target.value ? (e.target.value as PivotableField) : undefined)}
                style={selectStyle}
              >
                <option value="">None</option>
                {PIVOTABLE_FIELD_OPTIONS.filter((f) => f !== DATA_FIELD_TO_COLUMN[draftField]).map((f) => (
                  <option key={f} value={f}>
                    {PIVOT_FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>STARTING SIZE</div>
            <select value={draftSize} onChange={(e) => setDraftSize(e.target.value as DashboardWidget["size"])} style={selectStyle}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>{draftType === "bar" || draftType === "pie" ? "FALLBACK COLOR" : "COLOR"}</div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => setDraftColor(c)}
                  title={c}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    background: c,
                    border: draftColor === c ? "2px solid var(--text-primary)" : "1px solid var(--border)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={draftColor ?? "#0d9488"}
                onChange={(e) => setDraftColor(e.target.value)}
                title="Custom color"
                style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
              />
              {draftColor && (
                <button onClick={() => setDraftColor(undefined)} title="Reset to default" style={miniResetStyle}>
                  ×
                </button>
              )}
            </div>
          </div>
          {(draftType === "bar" || draftType === "pie") && (
            <div style={{ width: "100%" }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>THEME — PER-CATEGORY PALETTE (OPTIONAL, OVERRIDES FALLBACK COLOR)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {PRESET_THEMES.map((theme) => (
                  <button
                    key={theme.name}
                    onClick={() => setDraftPalette(theme.colors)}
                    title={theme.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: `1px solid ${JSON.stringify(draftPalette) === JSON.stringify(theme.colors) ? "var(--signal)" : "var(--border)"}`,
                      background: "var(--panel)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex" }}>
                      {theme.colors.slice(0, 5).map((c, i) => (
                        <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c, marginLeft: i > 0 ? -3 : 0, border: "1px solid var(--panel)" }} />
                      ))}
                    </span>
                    <span style={{ fontSize: 11 }}>{theme.name}</span>
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                {draftPalette.map((c, idx) => (
                  <span key={idx} style={{ position: "relative", display: "inline-flex" }}>
                    <input
                      type="color"
                      value={c}
                      onChange={(e) => setDraftPalette((p) => p.map((x, i) => (i === idx ? e.target.value : x)))}
                      title={`Color ${idx + 1} — click to change`}
                      style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                    />
                    <button
                      onClick={() => setDraftPalette((p) => p.filter((_, i) => i !== idx))}
                      title="Remove this color"
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        width: 14,
                        height: 14,
                        lineHeight: "12px",
                        fontSize: 10,
                        padding: 0,
                        borderRadius: "50%",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        color: "var(--critical)",
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => setDraftPalette((p) => [...p, PRESET_THEMES[0].colors[p.length % PRESET_THEMES[0].colors.length]])}
                  title="Add a color to this palette — no limit"
                  style={{ ...miniResetStyle, width: 22, height: 22, fontSize: 14, color: "var(--signal)" }}
                >
                  +
                </button>
                {draftPalette.length > 0 && (
                  <button onClick={() => setDraftPalette([])} style={{ fontSize: 10.5, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                    Clear palette
                  </button>
                )}
              </div>
            </div>
          )}
          {(draftType === "bar" || draftType === "pie") && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>TOP N (SCALE)</div>
              <input
                type="number"
                min={1}
                max={20}
                value={draftTopN ?? ""}
                onChange={(e) => setDraftTopN(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="All"
                style={{ ...selectStyle, width: 64 }}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>LABEL / CAPTION (OPTIONAL)</div>
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="e.g. source, note, date range…"
              style={{ ...selectStyle, width: "100%" }}
            />
          </div>
          {(draftType === "bar" || draftType === "line" || draftType === "pie") && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
              <input type="checkbox" checked={draftLegend} onChange={(e) => setDraftLegend(e.target.checked)} />
              Show legend
            </label>
          )}
          {(draftType === "bar" || draftType === "pie") && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
              <input type="checkbox" checked={draftDataLabels} onChange={(e) => setDraftDataLabels(e.target.checked)} />
              Show values on chart
            </label>
          )}
          <button onClick={addWidget} style={primaryBtnStyle}>
            Add
          </button>
          <button onClick={resetDraft} style={secondaryBtnStyle}>
            Cancel
          </button>
        </div>
      )}

      {Object.entries(categoryFilters).some(([, v]) => v) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "8px 24px", borderBottom: "1px solid var(--border-soft)" }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Filtered by:</span>
          {(Object.entries(categoryFilters) as [PivotableField, string | undefined][])
            .filter(([, v]) => v)
            .map(([field, value]) => (
              <span
                key={field}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  padding: "3px 6px 3px 10px",
                  borderRadius: 999,
                  background: "var(--signal-dim)",
                  border: "1px solid var(--signal)",
                }}
              >
                {PIVOT_FIELD_LABELS[field]}: {value}
                <button
                  onClick={() => setCategoryFilters((f) => ({ ...f, [field]: undefined }))}
                  title={`Remove ${PIVOT_FIELD_LABELS[field]} filter`}
                  style={{ background: "transparent", border: "none", color: "var(--text-primary)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          <button onClick={() => setCategoryFilters({})} style={{ ...secondaryBtnStyle, fontSize: 11.5, padding: "3px 8px" }}>
            Clear all
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {!loaded || !stats ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
        ) : widgets.length === 0 ? (
          <div className="panel" style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
            No widgets yet — click "+ Add widget" to build this dashboard from stat cards, charts, and a map. Drag any widget's edges to resize it, or click it to edit labels, color, and legend.
          </div>
        ) : (
          <ResponsiveGridLayout
            className="layout"
            layout={layout}
            cols={GRID_COLS}
            rowHeight={26}
            margin={[16, 16]}
            onLayoutChange={handleLayoutChange}
            draggableCancel=".no-drag"
            draggableHandle=".widget-drag-handle"
            isDraggable={!locked}
            isResizable={!locked}
          >
            {widgets.map((w) => (
              <div key={w.id}>
                <ErrorBoundary
                  fallback={(error, retry) => (
                    <div
                      className="panel"
                      style={{
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        padding: 16,
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--critical)" }}>This widget couldn't load</div>
                      <div style={{ fontSize: 10.5, color: "var(--text-faint)", wordBreak: "break-word" }}>{error.message}</div>
                      <button
                        onClick={retry}
                        style={{
                          fontSize: 11,
                          padding: "4px 10px",
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          borderRadius: 5,
                          cursor: "pointer",
                        }}
                      >
                        Try again
                      </button>
                    </div>
                  )}
                >
                  <DashboardWidgetCard
                    widget={w}
                    stats={stats}
                    incidents={incidents.filter((i) => i.latitude != null && i.longitude != null) as {
                      latitude: number;
                      longitude: number;
                      severity?: string | null;
                      actor?: string | null;
                      sector?: string | null;
                      tactic?: string | null;
                      occurred_date?: string | null;
                      city?: string | null;
                      province?: string | null;
                    }[]}
                    crosstabs={crosstabs}
                    breakdowns={breakdowns}
                    dailyBreakdowns={dailyBreakdowns}
                    datasets={datasets}
                    onDatasetCreated={(d) => setDatasets((prev) => [...prev, d])}
                    datasetSummaries={datasetSummaries}
                    activeCrossFilters={effectiveFilters}
                    onCrossFilterHoverStart={locked ? undefined : handleCrossFilterHoverStart}
                    onCrossFilterHoverEnd={locked ? undefined : handleCrossFilterHoverEnd}
                    onCrossFilterClick={locked ? undefined : handleCrossFilterClick}
                    onRemove={locked ? undefined : () => removeWidget(w.id)}
                    onRename={locked ? undefined : (title) => renameWidget(w.id, title)}
                    onUpdate={locked ? undefined : (patch) => updateWidget(w.id, patch)}
                  />
                </ErrorBoundary>
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
}

/** Shows the actual, current persistence state — not just "there's a Save
 *  button somewhere, hope you remember it." Idle right after loading reads as
 *  "saved" (there's nothing unsaved yet); a real failure stays visible with a
 *  retry rather than silently reverting to looking fine. */
function SaveStatusIndicator({
  status,
  errorDetail,
  onRetry,
}: {
  status: "idle" | "saving" | "saved" | "error";
  errorDetail: string | null;
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <button
        onClick={onRetry}
        style={{ ...secondaryBtnStyle, color: "var(--critical)", borderColor: "var(--critical)" }}
        title={errorDetail ? `Save failed: ${errorDetail} — click to retry` : "Click to retry saving"}
      >
        ⚠ Save failed — retry
      </button>
    );
  }
  if (status === "saving") {
    return <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Saving…</span>;
  }
  if (status === "idle") {
    return <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Unsaved changes…</span>;
  }
  return <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>✓ All changes saved</span>;
}

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

function DashboardFilterSelect({ label, value, options, onChange }: { label: string; value?: string; options?: string[]; onChange: (v: string | undefined) => void }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={{ fontSize: 12, padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text-primary)", width: "100%" }}
    >
      <option value="">{label}: All</option>
      {(options ?? []).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const liveBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "color-mix(in srgb, var(--signal) 14%, transparent)",
  border: "1px solid var(--signal)",
  color: "var(--signal)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text-primary)",
};

const miniResetStyle: React.CSSProperties = {
  fontSize: 12,
  width: 20,
  height: 20,
  lineHeight: "18px",
  padding: 0,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-muted)",
  cursor: "pointer",
};
