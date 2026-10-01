import { useCallback, useEffect, useState } from "react";
import * as L from "leaflet";
import type { IncidentItem } from "../api";

/** "Hide on map" — a per-browser display preference, NOT a data change.
 *  Hidden incidents stay in the database, in exports, dashboards and the
 *  Manage table; they're only left off the map markers/heatmap. Stored in
 *  localStorage so it survives a reload, and shared between every map in
 *  the app (Mapping, Search, Live Intel) via a same-tab custom event plus
 *  the cross-tab `storage` event — hiding an incident on one map hides it
 *  on all of them. Every storage access is wrapped: in a private window or
 *  with site data blocked it simply falls back to in-memory for the session. */
const STORAGE_KEY = "lens.hiddenIncidentIds";
const CHANGE_EVENT = "lens:hidden-incidents-changed";

let memoryFallback: string[] = [];

function readIds(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoryFallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return memoryFallback;
  }
}

function writeIds(ids: string[]) {
  memoryFallback = ids;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable — memoryFallback still carries it for this session
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export interface HiddenIncidents {
  hiddenIds: Set<string>;
  hide: (id: string) => void;
  unhide: (id: string) => void;
  showAll: () => void;
  /** Drops ids that no longer exist (e.g. after a delete) so the
   *  "N hidden" count never counts ghosts. */
  forget: (ids: string[]) => void;
}

export function useHiddenIncidents(): HiddenIncidents {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set(readIds()));

  useEffect(() => {
    const sync = () => setHiddenIds(new Set(readIds()));
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const hide = useCallback((id: string) => {
    const ids = readIds();
    if (!ids.includes(id)) writeIds([...ids, id]);
  }, []);
  const unhide = useCallback((id: string) => writeIds(readIds().filter((x) => x !== id)), []);
  const showAll = useCallback(() => writeIds([]), []);
  const forget = useCallback((gone: string[]) => {
    const goneSet = new Set(gone);
    const ids = readIds();
    const next = ids.filter((x) => !goneSet.has(x));
    if (next.length !== ids.length) writeIds(next);
  }, []);

  return { hiddenIds, hide, unhide, showAll, forget };
}

/** Floating "N hidden on map" control, rendered as a child of a react-leaflet
 *  MapContainer (bottom-left, above the scale bar). Expands to a list of the
 *  hidden incidents that are in the map's current data set, each with its
 *  own "Show" button, plus "Show all". Renders nothing when nothing in the
 *  current set is hidden. */
export function HiddenIncidentsControl({
  incidents,
  hidden,
}: {
  /** The map's full (pre-hide) incident set — used to label the list and to
   *  count only hidden incidents that would actually appear on this map. */
  incidents: IncidentItem[];
  hidden: HiddenIncidents;
}) {
  const [open, setOpen] = useState(false);
  // Stop clicks/scrolls inside the panel from panning/zooming the map or
  // triggering a map-click tool underneath it. A callback ref runs once per
  // mounted element, so the Leaflet listeners aren't re-added every render.
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  const hiddenHere = incidents.filter((i) => hidden.hiddenIds.has(i.id));
  if (hiddenHere.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: 10,
        bottom: 34,
        zIndex: 1000,
        background: "var(--panel, #fff)",
        color: "var(--text-primary, #222)",
        border: "1px solid var(--border, #ccc)",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        fontSize: 12,
        maxWidth: 300,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px" }}>
        <button onClick={() => setOpen((o) => !o)} style={ctlBtn} title="List hidden incidents">
          🙈 {hiddenHere.length} hidden {open ? "▾" : "▸"}
        </button>
        <button onClick={hidden.showAll} style={{ ...ctlBtn, color: "var(--signal, #1a73e8)" }}>
          Show all
        </button>
      </div>
      {open && (
        <div style={{ maxHeight: 220, overflowY: "auto", borderTop: "1px solid var(--border-soft, #eee)" }}>
          {hiddenHere.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: "1px solid var(--border-soft, #eee)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[i.city, i.district, i.county, i.province].filter(Boolean)[0] || i.precise_location || "Incident"}
                </div>
                <div style={{ color: "var(--text-muted, #777)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[i.occurred_date, i.actor, i.tactic].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button onClick={() => hidden.unhide(i.id)} style={ctlBtn}>
                Show
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ctlBtn: React.CSSProperties = {
  fontSize: 11.5,
  padding: "3px 7px",
  borderRadius: 4,
  border: "1px solid var(--border, #ccc)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
