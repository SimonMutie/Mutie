import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { THEMES, type DashTheme } from "./themes";
import { compileQuery, type VizFilter, type VizQuery, type VizResult, type VizSpec } from "./types";

/**
 * What the visuals on one dashboard share: where their data comes from (the
 * signed-in editor, or a shared link), the dashboard's date range and look,
 * and the selections — a click on one visual, or a choice in a slicer,
 * narrows every other visual built on the same data, the way a click does
 * in Power BI.
 */

export interface Selection {
  /** The widget the selection was made in; that widget is not narrowed by it. */
  origin: string;
  source: string;
  /** What was picked, for the "Filtered by" strip. */
  label: string;
  /** Identifies the pick, so clicking it again clears it. */
  key: string;
  filters: VizFilter[];
}

interface VizContext {
  mode: "edit" | "public";
  token?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Filters set elsewhere on the dashboard that apply to Incidents. */
  external: VizFilter[];
  theme: DashTheme;
  selections: Selection[];
  /** Sets (or with null, clears) the selection made in one widget. */
  select: (origin: string, selection: Selection | null) => void;
  clearAll: () => void;
  /** Changes when the data should be fetched afresh. */
  refreshKey: number;
}

const noop = () => {};
const DEFAULT: VizContext = { mode: "edit", external: [], theme: THEMES[0], selections: [], select: noop, clearAll: noop, refreshKey: 0 };
const Ctx = createContext<VizContext>(DEFAULT);

export const useViz = () => useContext(Ctx);
export const useVizTheme = () => useContext(Ctx).theme;

interface ProviderProps {
  mode: "edit" | "public";
  token?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  external?: VizFilter[];
  theme: DashTheme;
  refreshKey?: number;
  children: ReactNode;
}

export function VizProvider({ mode, token, dateFrom, dateTo, external, theme, refreshKey = 0, children }: ProviderProps) {
  const [selections, setSelections] = useState<Selection[]>([]);
  const select = useCallback((origin: string, selection: Selection | null) => {
    setSelections((all) => {
      const rest = all.filter((s) => s.origin !== origin);
      return selection && selection.filters.length ? [...rest, selection] : rest;
    });
  }, []);
  const clearAll = useCallback(() => setSelections([]), []);
  const externalKey = JSON.stringify(external ?? []);
  const value = useMemo<VizContext>(
    () => ({ mode, token, dateFrom, dateTo, external: JSON.parse(externalKey) as VizFilter[], theme, selections, select, clearAll, refreshKey }),
    [mode, token, dateFrom, dateTo, externalKey, theme, selections, select, clearAll, refreshKey],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The selection made in this widget, if any. */
export function useOwnSelection(widgetId: string): Selection | null {
  const { selections } = useViz();
  return selections.find((s) => s.origin === widgetId) ?? null;
}

export interface VizData {
  result: VizResult | null;
  loading: boolean;
  error: string | null;
  /** True when a selection made elsewhere is narrowing this visual. */
  narrowed: boolean;
}

/**
 * The data behind one visual, refetched when the visual, the date range or
 * a selection elsewhere changes. While a new answer is on its way the last
 * one stays, so a visual never flashes empty.
 */
export function useVizData(widgetId: string, viz: VizSpec): VizData {
  const ctx = useViz();
  const query = useMemo(() => compileQuery(viz), [viz]);
  const extra = useMemo(() => {
    const fromOthers = ctx.selections.filter((s) => s.source === viz.source && s.origin !== widgetId).flatMap((s) => s.filters);
    return [...(viz.source === "incidents" ? ctx.external : []), ...fromOthers];
  }, [ctx.selections, ctx.external, viz.source, widgetId]);

  const key = query ? JSON.stringify([ctx.mode, ctx.token, viz.source, query, extra, ctx.dateFrom, ctx.dateTo, ctx.refreshKey]) : "";
  // The shape of the answer (which groups, which figures). An answer of another shape is never handed to a visual.
  const shape = query ? JSON.stringify([query.dimensions, query.measures, query.rollups]) : "";
  const [state, setState] = useState<{ result: VizResult | null; shape: string; loading: boolean; error: string | null }>({ result: null, shape: "", loading: !!query, error: null });
  const request = useRef(0);

  useEffect(() => {
    if (!key || !query) {
      request.current++;
      setState({ result: null, shape: "", loading: false, error: null });
      return;
    }
    const mine = ++request.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    // A short pause, so dragging fields about in the builder asks once it settles.
    const timer = setTimeout(async () => {
      try {
        let result: VizResult;
        if (ctx.mode === "public" && ctx.token) {
          result = await api.runPublicViz(ctx.token, widgetId, extra.slice(0, 8));
        } else {
          const merged: VizQuery = { ...query, filters: [...(query.filters ?? []), ...extra].slice(0, 12) };
          result = await api.runVizQuery(viz.source, merged, { from: ctx.dateFrom, to: ctx.dateTo });
        }
        if (mine === request.current) setState({ result, shape, loading: false, error: null });
      } catch (err) {
        if (mine === request.current) setState({ result: null, shape: "", loading: false, error: err instanceof Error ? err.message : "The data could not be loaded." });
      }
    }, 140);
    return () => clearTimeout(timer);
    // `key` carries everything the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { result: state.shape === shape ? state.result : null, loading: state.loading, error: state.error, narrowed: extra.length > 0 };
}
