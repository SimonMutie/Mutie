import { useEffect, useSyncExternalStore } from "react";
import { api, type CountryStatusRow, type IncidentHistoryPoint } from "../api";

/**
 * The strategic picture on the Live map: country conflict status, incident circles, the timeline filter, maritime
 * chokepoints and analysts' scenarios.
 * Shared state for the layer list, both maps, the legend and the timeline: which parts are on (remembered in the
 * browser), the period the timeline is narrowed to (for the visit only), and the data, fetched once and refreshed.
 */

export type StrategicPart = "status" | "circles" | "timeline" | "chokepoints" | "scenarios";
type On = Record<StrategicPart, boolean>;
const KEY = "lens-strategic";

function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      subs.forEach((f) => f());
    },
    use: () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => value, () => value),
  };
}

const on = store<On>(
  (() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<On> | null;
      return { status: !!v?.status, circles: !!v?.circles, timeline: !!v?.timeline, chokepoints: !!v?.chokepoints, scenarios: !!v?.scenarios };
    } catch {
      return { status: false, circles: false, timeline: false, chokepoints: false, scenarios: false };
    }
  })()
);
export const useStrategic = on.use;
export function toggleStrategic(part: StrategicPart, value?: boolean) {
  const next = { ...on.get(), [part]: value ?? !on.get()[part] };
  on.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

/** The period the timeline is narrowed to: first and last day, inclusive (YYYY-MM-DD). Null: all time. */
export type Period = { from: string; to: string } | null;
const period = store<Period>(null);
export const usePeriod = period.use;
export const setPeriod = period.set;
/** Whether a date (any ISO date or time) falls inside the period. Undated items stay shown. */
export function inPeriod(p: Period, when: string | null | undefined): boolean {
  if (!p || !when) return true;
  const d = when.slice(0, 10);
  return d >= p.from && d <= p.to;
}

/* ── Data: fetched while something needs it, refreshed every 10 minutes ─────────────────────────────────────── */

export const HISTORY_SINCE = "2025-01-01";
const history = store<IncidentHistoryPoint[] | null>(null);
const status = store<CountryStatusRow[] | null>(null);
const REFRESH = 10 * 60_000;

function poller(load: () => Promise<void>) {
  let users = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = 0;
  return {
    start() {
      users++;
      if (users === 1) {
        if (Date.now() - last > REFRESH) void load().then(() => (last = Date.now()));
        timer = setInterval(() => void load().then(() => (last = Date.now())), REFRESH);
      }
    },
    stop() {
      users--;
      if (users === 0 && timer) clearInterval(timer);
    },
    now: () => load().then(() => (last = Date.now())),
  };
}
const historyPoll = poller(async () => {
  const r = await api.getIncidentHistory(HISTORY_SINCE).catch(() => null);
  if (r) history.set(r.items);
});
const statusPoll = poller(async () => {
  const r = await api.getCountryStatus().catch(() => null);
  if (r) status.set(r.countries);
});

/** The incident history while `active`; null until loaded. */
export function useIncidentHistory(active: boolean): IncidentHistoryPoint[] | null {
  useEffect(() => {
    if (!active) return;
    historyPoll.start();
    return () => historyPoll.stop();
  }, [active]);
  return history.use();
}
/** Country ratings while `active`; null until loaded. */
export function useCountryStatus(active: boolean): CountryStatusRow[] | null {
  useEffect(() => {
    if (!active) return;
    statusPoll.start();
    return () => statusPoll.stop();
  }, [active]);
  return status.use();
}
export const reloadCountryStatus = () => statusPoll.now();
