import { useMemo, useState, type CSSProperties } from "react";
import type { SavedShape } from "../../api";
import { partsOf } from "../../studio/proximity";
import { toMgrs } from "../coords";
import { EXPORT_LABEL, exportFeatures, type ExportFormat, type GisFeature } from "./exporters";
import { circleRingLngLat, fmtKm, haversineKm, insideRing } from "./gisMath";
import type { GisRing } from "./GlobeGis";
import { composePrint, savePrint, type PrintView } from "./printMap";

const C = { text: "#e6edf7", muted: "#8fa3bf", line: "rgba(255,255,255,0.1)", accent: "#3fd0ff", warn: "#ffd23f" };
const input: CSSProperties = { padding: "5px 7px", fontSize: 11.5, fontFamily: "inherit", background: "rgba(0,0,0,0.35)", color: C.text, border: "1px solid rgba(255,255,255,0.16)", borderRadius: 5, minWidth: 0 };
const button = (active = false): CSSProperties => ({ padding: "5px 9px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 5, border: `1px solid ${active ? C.accent : "rgba(255,255,255,0.16)"}`, background: active ? "rgba(63,208,255,0.16)" : "rgba(255,255,255,0.06)", color: C.text });
const label: CSSProperties = { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, fontWeight: 700 };

type SortKey = "layer" | "title" | "time" | "lat" | "lng" | "near";
const ROW_LIMIT = 400;

/** Polygons of a saved Map Studio shape, as outer rings, for "inside this shape". Circles are stored as polygons. */
function shapeRings(s: SavedShape): [number, number][][] {
  return partsOf(s.geometry).polygons.map((p) => p[0]).filter((r) => r && r.length >= 4);
}

export interface GisPanelProps {
  features: GisFeature[];
  shapes: SavedShape[];
  rings: GisRing[];
  onRings: (r: GisRing[]) => void;
  onFocus: (f: GisFeature) => void;
  getPrintView: () => Promise<PrintView>;
  legend: { label: string; color: string; count: number }[];
}

/**
 * GIS tools for the Live map. Table: every feature on the map, searchable and sortable, filtered by layer or by a
 * Map Studio area; buffers round the selected features and a count of what falls inside them; export of the rows in
 * view or selected as GeoJSON, KML, CSV or a shapefile. Print: the current view as an A4 map sheet.
 */
export function GisPanel(props: GisPanelProps) {
  const [tab, setTab] = useState<"table" | "print">("table");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, color: C.text, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={button(tab === "table")} onClick={() => setTab("table")}>Attribute table</button>
        <button style={button(tab === "print")} onClick={() => setTab("print")}>Print map</button>
      </div>
      {tab === "table" ? <AttributeTable {...props} /> : <PrintTab {...props} />}
    </div>
  );
}

function AttributeTable({ features, shapes, rings, onRings, onFocus }: GisPanelProps) {
  const [q, setQ] = useState("");
  const [layer, setLayer] = useState("");
  const [within, setWithin] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "time", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [km, setKm] = useState(15);
  const [format, setFormat] = useState<ExportFormat>("geojson");
  const [withShapes, setWithShapes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const layers = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of features) m.set(f.layer, (m.get(f.layer) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [features]);
  const areaShapes = useMemo(() => shapes.filter((s) => shapeRings(s).length), [shapes]);

  // Distance from each feature to the nearest selected one, for the "near" column and the buffer count.
  const selectedFeatures = useMemo(() => features.filter((f) => selected.has(f.id)), [features, selected]);
  const nearKm = useMemo(() => {
    const out = new Map<string, number>();
    if (!selectedFeatures.length || selectedFeatures.length > 200) return out;
    for (const f of features) {
      if (selected.has(f.id)) continue;
      let best = Infinity;
      for (const s of selectedFeatures) best = Math.min(best, haversineKm(f, s));
      out.set(f.id, best);
    }
    return out;
  }, [features, selectedFeatures, selected]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shape = within ? areaShapes.find((s) => s.id === within) : null;
    const shapeR = shape ? shapeRings(shape) : [];
    const list = features.filter((f) =>
      (!layer || f.layer === layer) &&
      (!needle || `${f.title} ${f.subtitle ?? ""} ${f.layer}`.toLowerCase().includes(needle)) &&
      (!shapeR.length || shapeR.some((r) => insideRing(f, r)))
    );
    const val = (f: GisFeature): string | number => {
      switch (sort.key) {
        case "layer": return f.layer;
        case "title": return f.title.toLowerCase();
        case "time": return f.time ? Date.parse(f.time) || 0 : 0;
        case "lat": return f.lat;
        case "lng": return f.lng;
        case "near": return nearKm.get(f.id) ?? (selected.has(f.id) ? -1 : Infinity);
      }
    };
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [features, q, layer, within, areaShapes, sort, nearKm, selected]);

  const insideBuffer = useMemo(() => {
    if (!selectedFeatures.length) return null;
    const near = features.filter((f) => !selected.has(f.id) && (nearKm.get(f.id) ?? Infinity) <= km);
    const byLayer = new Map<string, number>();
    for (const f of near) byLayer.set(f.layer, (byLayer.get(f.layer) ?? 0) + 1);
    return { total: near.length, byLayer: [...byLayer].sort((a, b) => b[1] - a[1]) };
  }, [features, selected, selectedFeatures, nearKm, km]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const head = (key: SortKey, text: string) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "time" ? -1 : 1 }))} style={{ textAlign: "left", padding: "4px 5px", cursor: "pointer", whiteSpace: "nowrap", color: sort.key === key ? C.accent : C.muted, fontWeight: 700, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", position: "sticky", top: 0, background: "rgba(10,16,28,0.98)" }}>
      {text}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  const doExport = async (which: "selected" | "view") => {
    const list = which === "selected" ? selectedFeatures : rows;
    if (!list.length && !(withShapes && shapes.length)) { setMsg("Nothing to export."); return; }
    setBusy(true);
    setMsg(null);
    try {
      const usable: GeoJSON.Feature[] = [];
      if (withShapes) {
        for (const s of shapes) {
          const fs = s.geometry.type === "FeatureCollection" ? s.geometry.features : [s.geometry];
          for (const f of fs) if (f.geometry) usable.push({ ...f, properties: { ...(f.properties ?? {}), name: s.name, layer: "Map Studio", source: s.source } });
        }
        // Buffers are written as true circles on the ground.
        for (const r of rings) usable.push({ type: "Feature", properties: { layer: "Buffer", name: r.label ?? `${r.km} km buffer`, radius_km: r.km }, geometry: { type: "Polygon", coordinates: [circleRingLngLat(r, r.km)] } });
      }
      if (format === "csv" || format === "kml") {
        await exportFeatures(list, format, "lens-features");
        if (usable.length) setMsg(`${EXPORT_LABEL[format]} holds points only; choose GeoJSON or Shapefile to include areas and buffers.`);
      } else await exportFeatures(list, format, "lens-features", usable);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  };

  const ringSelected = () => {
    if (!selectedFeatures.length) { setMsg("Tick one or more rows to draw buffers round them."); return; }
    const chosen = selectedFeatures.slice(0, 40);
    onRings(chosen.map((f) => ({ lat: f.lat, lng: f.lng, km, label: `${km} km round ${f.title.slice(0, 40)}`, color: C.warn })));
    setMsg(selectedFeatures.length > 40 ? "Buffers drawn round the first 40 selected." : null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <input style={{ ...input, gridColumn: "1 / 3" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and details" />
        <select style={input} value={layer} onChange={(e) => setLayer(e.target.value)}>
          <option value="">All layers ({features.length})</option>
          {layers.map(([l, n]) => <option key={l} value={l}>{l} ({n})</option>)}
        </select>
        <select style={input} value={within} onChange={(e) => setWithin(e.target.value)} title="Only features inside an area drawn or imported in Map Studio">
          <option value="">Anywhere</option>
          {areaShapes.map((s) => <option key={s.id} value={s.id}>Inside: {s.name}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: C.muted }}>
        <span>{rows.length.toLocaleString()} shown{selected.size ? ` · ${selected.size} selected` : ""}{rows.length > ROW_LIMIT ? ` · first ${ROW_LIMIT} listed` : ""}</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button style={button()} onClick={() => setSelected(new Set(rows.map((r) => r.id)))}>Select shown</button>
          <button style={button()} onClick={() => setSelected(new Set())}>Clear</button>
        </span>
      </div>

      <div style={{ overflow: "auto", maxHeight: "42vh", border: `1px solid ${C.line}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ position: "sticky", top: 0, background: "rgba(10,16,28,0.98)", width: 22 }} />
              {head("layer", "Layer")}
              {head("title", "Title")}
              {head("time", "Time")}
              {head("lat", "Lat")}
              {head("lng", "Lon")}
              {selected.size > 0 && head("near", "Near")}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, ROW_LIMIT).map((f) => (
              <tr key={f.id} style={{ borderTop: `1px solid ${C.line}`, background: selected.has(f.id) ? "rgba(63,208,255,0.08)" : undefined }}>
                <td style={{ padding: "3px 5px" }}><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} /></td>
                <td style={{ padding: "3px 5px", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: f.color ?? C.accent, marginRight: 5 }} />
                  {f.layer}
                </td>
                <td style={{ padding: "3px 5px", maxWidth: 190 }}>
                  <button onClick={() => onFocus(f)} title={`${f.subtitle ?? ""}\nMGRS ${toMgrs(f.lat, f.lng)}\nClick to go there`} style={{ all: "unset", cursor: "pointer", color: C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.title || "(untitled)"}
                  </button>
                </td>
                <td style={{ padding: "3px 5px", whiteSpace: "nowrap", color: C.muted }}>{f.time ? new Date(f.time).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : ""}</td>
                <td style={{ padding: "3px 5px", fontFamily: "ui-monospace, monospace" }}>{f.lat.toFixed(4)}</td>
                <td style={{ padding: "3px 5px", fontFamily: "ui-monospace, monospace" }}>{f.lng.toFixed(4)}</td>
                {selected.size > 0 && <td style={{ padding: "3px 5px", whiteSpace: "nowrap", color: C.muted }}>{selected.has(f.id) ? "selected" : nearKm.has(f.id) ? fmtKm(nearKm.get(f.id)!) : ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div style={{ padding: 12, fontSize: 11.5, color: C.muted }}>No features. Turn on layers in the left panel, or loosen the filters.</div>}
      </div>

      <div style={{ ...label, marginTop: 4 }}>Buffer</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input type="number" min={0.1} step={0.5} value={km} onChange={(e) => setKm(Math.max(0.1, Number(e.target.value) || 1))} style={{ ...input, width: 70 }} />
        <span style={{ fontSize: 11, color: C.muted }}>km</span>
        <button style={button()} onClick={ringSelected}>Draw round selected</button>
        {rings.length > 0 && <button style={button()} onClick={() => onRings([])}>Remove buffers ({rings.length})</button>}
      </div>
      {insideBuffer && (
        <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          <b>{insideBuffer.total}</b> other feature{insideBuffer.total === 1 ? "" : "s"} within {km} km of the selection
          {insideBuffer.byLayer.length > 0 && <span style={{ color: C.muted }}>: {insideBuffer.byLayer.map(([l, n]) => `${l} ${n}`).join(", ")}</span>}
        </div>
      )}

      <div style={{ ...label, marginTop: 4 }}>Export</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select style={input} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          {(Object.keys(EXPORT_LABEL) as ExportFormat[]).map((k) => <option key={k} value={k}>{EXPORT_LABEL[k]}</option>)}
        </select>
        <button style={button()} disabled={busy} onClick={() => doExport("view")}>Rows shown</button>
        <button style={button()} disabled={busy || !selected.size} onClick={() => doExport("selected")}>Selected</button>
      </div>
      <label style={{ fontSize: 11, color: C.muted, display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={withShapes} onChange={(e) => setWithShapes(e.target.checked)} />
        Include Map Studio shapes and buffers (GeoJSON and Shapefile)
      </label>
      <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
        All formats are WGS 84 longitude/latitude (EPSG:4326). A shapefile comes as a zip with one set per geometry type, ready for QGIS or ArcGIS. To bring data in (GeoJSON, KML/KMZ, shapefile, GPX, CSV with lat/lon), use Import in Map Studio.
      </div>
      {msg && <div style={{ fontSize: 11.5, color: C.warn }}>{msg}</div>}
    </div>
  );
}

function PrintTab({ getPrintView, legend }: GisPanelProps) {
  const [title, setTitle] = useState("Situation map");
  const [subtitle, setSubtitle] = useState("");
  const [notes, setNotes] = useState("");
  const [grid, setGrid] = useState(true);
  const [legendOn, setLegendOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setErr(null);
    try {
      const view = await getPrintView();
      const c = await composePrint(view, { title, subtitle, notes, grid, legend: legendOn ? legend : [] });
      setSheet(c);
      setPreview(c.toDataURL("image/jpeg", 0.7));
      if (!view.image) setErr(view.mode === "flat" ? "The flat map's basemap needs the MapTiler key in Settings; the sheet shows the features without it. The 3D globe prints with its basemap." : "The map image could not be read.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The map could not be printed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
        An A4 landscape sheet of the map as it is now, with a coordinate grid, scale bar, north arrow, legend and title block. Frame the map first, then make the sheet.
      </div>
      <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <input style={input} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle (area, period)" />
      <textarea style={{ ...input, minHeight: 58, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      <div style={{ display: "flex", gap: 14, fontSize: 11.5 }}>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid</label>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={legendOn} onChange={(e) => setLegendOn(e.target.checked)} /> Legend ({legend.length})</label>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={button(true)} disabled={busy} onClick={make}>{busy ? "Making…" : sheet ? "Make again" : "Make sheet"}</button>
        {sheet && <button style={button()} onClick={() => savePrint(sheet, "pdf", title)}>Save PDF</button>}
        {sheet && <button style={button()} onClick={() => savePrint(sheet, "png", title)}>Save PNG</button>}
      </div>
      {err && <div style={{ fontSize: 11.5, color: C.warn }}>{err}</div>}
      {preview && <img src={preview} alt="Print preview" style={{ width: "100%", borderRadius: 4, border: `1px solid ${C.line}` }} />}
    </div>
  );
}
