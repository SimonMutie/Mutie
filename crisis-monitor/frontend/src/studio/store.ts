import { useSyncExternalStore } from "react";
import { api, type SavedShape, type ShapeSource, type ShapeStyle } from "../api";
import { circleRing } from "./geo";
import { iconDef } from "./icons";
import buffer from "@turf/buffer";

export type Tool = "select" | "polygon" | "rectangle" | "circle" | "line" | "freehand" | "icon";

export const DEFAULT_STYLE: ShapeStyle = {
  color: "#38BDF8",
  fillColor: "#38BDF8",
  fillOpacity: 0.3,
  weight: 2.5,
  pattern: "solid",
  patternSize: 10,
  patternWeight: 1.6,
  dashArray: null,
};

export const DEFAULT_ICON: ShapeStyle = { icon: "pin", iconColor: undefined, iconSize: 38, label: "", labelOn: true };

type Override = Partial<ShapeStyle> & { name?: string };
interface State {
  tool: Tool;
  selectedId: string | null;
  /** The look given to the next shape drawn. */
  draft: ShapeStyle;
  /** The look given to the next icon placed. */
  iconDraft: ShapeStyle;
  /** Edits shown at once while they are being saved. */
  overrides: Record<string, Override>;
  /** A request to fly to a shape; `n` makes repeats count. */
  zoom: { id: string; n: number } | null;
  /** Files dropped on the map, waiting for the import panel. */
  dropped: File[] | null;
  /** The last message from a map action. */
  notice: string | null;
  /** Whether edits to the selected shape are saved yet. */
  saveState: "idle" | "saving" | "saved";
  /** A button press for the drawing tool in progress. */
  command: { kind: "finish" | "cancel"; n: number } | null;
}

let state: State = { tool: "select", selectedId: null, draft: DEFAULT_STYLE, iconDraft: DEFAULT_ICON, overrides: {}, zoom: null, dropped: null, notice: null, saveState: "idle", command: null };
const listeners = new Set<() => void>();
let onChanged: () => void = () => {};

export const studio = {
  get: () => state,
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  configure(h: { onChanged: () => void }) {
    onChanged = h.onChanged;
  },
  select(id: string | null) {
    studio.set({ selectedId: id });
  },
  zoomTo(id: string) {
    studio.set({ zoom: { id, n: (state.zoom?.n ?? 0) + 1 } });
  },
};

export function sendCommand(kind: "finish" | "cancel") {
  studio.set({ command: { kind, n: (state.command?.n ?? 0) + 1 } });
}

export function useStudio(): State {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => state
  );
}

// ── Saving ──────────────────────────────────────────────────────────────

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Override>();

async function flush(id: string): Promise<void> {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const p = pending.get(id);
  pending.delete(id);
  if (!p) return;
  const { name, ...style } = p;
  try {
    await api.updateMapShape(id, { ...(name !== undefined ? { name } : {}), ...(Object.keys(style).length ? { style } : {}) });
    onChanged();
    if (!pending.size) {
      studio.set({ saveState: "saved" });
      setTimeout(() => state.saveState === "saved" && !pending.size && studio.set({ saveState: "idle" }), 2500);
    }
  } catch (e) {
    studio.set({ saveState: "idle", notice: e instanceof Error ? e.message : "Could not save that change." });
  } finally {
    // The refreshed list now carries the change; drop the stand-in once it has arrived.
    setTimeout(() => {
      const { [id]: _gone, ...rest } = studio.get().overrides;
      if (!pending.has(id)) studio.set({ overrides: rest });
    }, 800);
  }
}

/** Shows a style or name change at once and saves it a moment after the last change. */
export function editShape(id: string, patch: Override): void {
  const merged = { ...state.overrides[id], ...patch };
  studio.set({ overrides: { ...state.overrides, [id]: merged }, saveState: "saving" });
  pending.set(id, { ...pending.get(id), ...patch });
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => void flush(id), 900));
}

/** Saves any edits still waiting, now. */
export async function saveNow(): Promise<void> {
  await Promise.all([...pending.keys()].map(flush));
}

export async function removeShapes(ids: string[]): Promise<void> {
  try {
    await Promise.all(ids.map((id) => api.deleteMapShape(id)));
    if (state.selectedId && ids.includes(state.selectedId)) studio.select(null);
    onChanged();
  } catch (e) {
    studio.set({ notice: e instanceof Error ? e.message : "Could not delete those." });
    onChanged();
  }
}

export async function saveGeometry(id: string, geometry: GeoJSON.Feature | GeoJSON.FeatureCollection): Promise<void> {
  studio.set({ saveState: "saving" });
  try {
    await api.updateMapShape(id, { geometry });
    onChanged();
    studio.set({ saveState: "saved" });
    setTimeout(() => state.saveState === "saved" && studio.set({ saveState: "idle" }), 2500);
  } catch (e) {
    studio.set({ saveState: "idle" });
    studio.set({ notice: e instanceof Error ? e.message : "Could not save that edit." });
  }
}

export async function createShape(geometry: GeoJSON.Feature | GeoJSON.FeatureCollection, o: { name: string; style: ShapeStyle; source: ShapeSource }): Promise<SavedShape | null> {
  try {
    const row = await api.createMapShape({ name: o.name, source: o.source, geometry, style: o.style });
    onChanged();
    return row;
  } catch (e) {
    studio.set({ notice: e instanceof Error ? e.message : "Could not save that shape." });
    return null;
  }
}

export async function removeShape(id: string): Promise<void> {
  try {
    await api.deleteMapShape(id);
    if (state.selectedId === id) studio.select(null);
    onChanged();
  } catch (e) {
    studio.set({ notice: e instanceof Error ? e.message : "Could not delete that shape." });
  }
}

export async function duplicateShape(s: SavedShape): Promise<void> {
  const geometry = JSON.parse(JSON.stringify(s.geometry)) as SavedShape["geometry"];
  // Offset a copy slightly so it does not sit exactly on the original.
  const shift = (c: unknown): unknown => (typeof (c as number[])[0] === "number" ? [(c as number[])[0] + 0.01, (c as number[])[1] - 0.01] : (c as unknown[]).map(shift));
  const move = (f: GeoJSON.Feature) => (f.geometry ? { ...f, geometry: { ...f.geometry, coordinates: shift((f.geometry as { coordinates: unknown }).coordinates) } as GeoJSON.Geometry } : f);
  const g = geometry.type === "FeatureCollection" ? { ...geometry, features: geometry.features.map(move) } : move(geometry);
  const row = await createShape(g, { name: `${s.name} copy`, style: { ...s.style, ...state.overrides[s.id] }, source: s.source });
  if (row) studio.select(row.id);
}

/** A new polygon covering everything within `km` of a feature. Used for buffers and for search bands around routes. */
export async function bufferFeature(feature: GeoJSON.Feature, km: number, name: string, style?: ShapeStyle): Promise<void> {
  try {
    const out = buffer(feature, km, { units: "kilometers" });
    if (!out) throw new Error("That shape cannot be buffered.");
    const f = out as GeoJSON.Feature;
    const row = await createShape({ type: "Feature", properties: { buffer_km: km }, geometry: f.geometry }, { name, style: style ?? { ...DEFAULT_STYLE, pattern: "stripes-d1", fillOpacity: 0.2 }, source: "drawn" });
    if (row) studio.select(row.id);
  } catch (e) {
    studio.set({ notice: e instanceof Error ? e.message : "Could not buffer that shape." });
  }
}

/** A new polygon covering everything within `km` of the shape. */
export async function bufferShape(s: SavedShape, km: number): Promise<void> {
  const f: GeoJSON.Feature = s.geometry.type === "Feature" ? s.geometry : { type: "Feature", properties: {}, geometry: { type: "GeometryCollection", geometries: s.geometry.features.map((x) => x.geometry) } };
  await bufferFeature(f, km, `${s.name}: ${km} km band`, { ...DEFAULT_STYLE, ...s.style, ...state.overrides[s.id], icon: undefined, pattern: "stripes-d1", fillOpacity: 0.2 });
}

export async function placeIcon(lng: number, lat: number): Promise<void> {
  const d = state.iconDraft;
  const def = iconDef(d.icon);
  const style: ShapeStyle = { ...d, iconColor: d.iconColor ?? def.color };
  const row = await createShape({ type: "Feature", properties: { studio: "icon", icon: d.icon }, geometry: { type: "Point", coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] } }, { name: d.label || def.label, style, source: "icon" });
  if (row) studio.select(row.id);
}

export const circleFeature = (lng: number, lat: number, radiusM: number): GeoJSON.Feature => ({ type: "Feature", properties: { circle: { radiusM: Math.round(radiusM) } }, geometry: { type: "Polygon", coordinates: [circleRing(lng, lat, radiusM)] } });

export async function setVisible(id: string, visible: boolean): Promise<void> {
  try {
    await api.updateMapShape(id, { visible });
    onChanged();
  } catch (e) {
    studio.set({ notice: e instanceof Error ? e.message : "Could not change that." });
  }
}
