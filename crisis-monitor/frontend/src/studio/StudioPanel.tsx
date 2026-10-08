import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Circle, Copy, Download, Eye, EyeOff, FileUp, Layers, MapPin, MousePointer2, Pencil, PenLine, Spline, Square, Trash2, Upload, Waypoints, ZoomIn } from "lucide-react";
import type { SavedShape, ShapeSource, ShapeStyle } from "../api";
import { downloadText, fitLayerToSize, fmtArea, fmtLength, measure, toKml } from "./geo";
import { HUD, DASHES, SWATCHES, glass, inputStyle } from "./hud";
import { ICONS, ICON_CATEGORIES, iconDef, iconSvg } from "./icons";
import { ACCEPT, FORMATS, importGeoFiles, type Imported } from "./importers";
import { PATTERNS, hasPattern, previewSvg, type PatternKey } from "./patterns";
import { DEFAULT_STYLE, bufferShape, createShape, duplicateShape, editShape, removeShape, removeShapes, saveNow, setVisible, studio, useStudio, type Tool } from "./store";

const TOOLS: { key: Tool; label: string; icon: ReactNode; hint: string }[] = [
  { key: "select", label: "Select", icon: <MousePointer2 size={16} />, hint: "Click a shape to style or reshape it. Drag its corners; click a small dot to add a corner; double-click a corner to remove it." },
  { key: "polygon", label: "Polygon", icon: <PenLine size={16} />, hint: "Click to place corners. Click the first point, double-click or press Enter to finish. Backspace undoes the last corner." },
  { key: "rectangle", label: "Rectangle", icon: <Square size={16} />, hint: "Click one corner, then the opposite corner." },
  { key: "circle", label: "Circle", icon: <Circle size={16} />, hint: "Click the centre, move out to the radius, click again." },
  { key: "line", label: "Line", icon: <Spline size={16} />, hint: "Click to place points. Double-click or press Enter to finish. The length shows as you go." },
  { key: "freehand", label: "Freehand", icon: <Pencil size={16} />, hint: "Press and hold, draw round the area, then let go." },
  { key: "icon", label: "Icon", icon: <MapPin size={16} />, hint: "Pick an icon below, then click the map to place it. Click again to place more." },
];

const label: CSSProperties = { fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted, fontWeight: 600 };
const btn = (active = false, danger = false): CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 9px", borderRadius: 7,
  border: `1px solid ${active ? HUD.gold : danger ? "rgba(255,61,61,.4)" : HUD.border}`,
  background: active ? "rgba(212,175,55,.18)" : "rgba(255,255,255,.03)", color: active ? HUD.goldLight : danger ? HUD.red : HUD.textSecondary,
});

function Row({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {title && <div style={label}>{title}</div>}
      {children}
    </div>
  );
}

function Slider({ title, value, min, max, step = 1, onChange, unit = "" }: { title: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: HUD.textSecondary }}>
        <span>{title}</span>
        <span style={{ color: HUD.textMuted }}>
          {Number.isInteger(step) ? value : value.toFixed(2)}
          {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Colour({ title, value, onChange }: { title: string; value: string; onChange: (c: string) => void }) {
  return (
    <Row title={title}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {SWATCHES.map((c) => (
          <button key={c} onClick={() => onChange(c)} title={c} style={{ width: 18, height: 18, borderRadius: 5, background: c, cursor: "pointer", padding: 0, border: value.toLowerCase() === c.toLowerCase() ? `2px solid ${HUD.goldLight}` : "1px solid rgba(255,255,255,.25)" }} />
        ))}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#38bdf8"} onChange={(e) => onChange(e.target.value)} title="Any colour" style={{ width: 24, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
      </div>
    </Row>
  );
}

/** Fill, outline, pattern and (for icons) icon controls for one style. */
function StyleEditor({ style, onChange, isIcon, isLine }: { style: ShapeStyle; onChange: (p: Partial<ShapeStyle>) => void; isIcon: boolean; isLine: boolean }) {
  const st = { ...DEFAULT_STYLE, ...style };
  const stroke = st.color ?? "#38BDF8";
  const fill = st.fillColor ?? stroke;
  const pat = (st.pattern ?? "solid") as PatternKey;
  if (isIcon) return null;
  return (
    <>
      {!isLine && (
        <>
          <Row title="Fill pattern">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
              {PATTERNS.map((p) => (
                <button
                  key={p.key}
                  title={p.label}
                  onClick={() => onChange({ pattern: p.key })}
                  style={{ padding: 2, borderRadius: 7, cursor: "pointer", background: "rgba(255,255,255,.04)", border: `1px solid ${pat === p.key ? HUD.gold : HUD.border}`, lineHeight: 0 }}
                  dangerouslySetInnerHTML={{ __html: previewSvg({ key: p.key, color: st.patternColor ?? stroke, size: st.patternSize ?? 10, weight: st.patternWeight ?? 1.6, bg: fill, bgOpacity: Math.max(0.3, st.fillOpacity ?? 0.3) }, 44, 30) }}
                />
              ))}
            </div>
            <div style={{ fontSize: 10, color: HUD.textMuted }}>{PATTERNS.find((p) => p.key === pat)?.label}</div>
          </Row>
          <Colour title="Fill colour" value={fill} onChange={(c) => onChange({ fillColor: c })} />
          <Slider title={hasPattern(pat) ? "Background tint" : "Fill strength"} value={st.fillOpacity ?? 0.3} min={0} max={1} step={0.05} onChange={(v) => onChange({ fillOpacity: v })} />
          {hasPattern(pat) && (
            <>
              <Colour title="Pattern line colour" value={st.patternColor ?? stroke} onChange={(c) => onChange({ patternColor: c })} />
              <Slider title="Spacing" value={st.patternSize ?? 10} min={4} max={40} onChange={(v) => onChange({ patternSize: v })} unit=" px" />
              <Slider title="Line thickness" value={st.patternWeight ?? 1.6} min={0.5} max={8} step={0.1} onChange={(v) => onChange({ patternWeight: v })} unit=" px" />
            </>
          )}
        </>
      )}
      <Colour title={isLine ? "Line colour" : "Outline colour"} value={stroke} onChange={(c) => onChange({ color: c })} />
      <Slider title="Outline thickness" value={st.weight ?? 2.5} min={0} max={14} step={0.5} onChange={(v) => onChange({ weight: v })} unit=" px" />
      <Slider title="Outline opacity" value={st.strokeOpacity ?? 1} min={0} max={1} step={0.05} onChange={(v) => onChange({ strokeOpacity: v })} />
      <Row title="Outline style">
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {DASHES.map((d) => (
            <button key={d.label} onClick={() => onChange({ dashArray: d.value })} style={btn((st.dashArray ?? null) === d.value)}>
              {d.label}
            </button>
          ))}
        </div>
      </Row>
    </>
  );
}

function IconPicker({ style, onChange }: { style: ShapeStyle; onChange: (p: Partial<ShapeStyle>) => void }) {
  const [cat, setCat] = useState<string>(ICON_CATEGORIES[0]);
  const def = iconDef(style.icon);
  const list = ICONS.filter((i) => i.cat === cat);
  return (
    <>
      <Row title="Icon">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {ICON_CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(c)} style={{ ...btn(cat === c), padding: "3px 7px", fontSize: 10 }}>
              {c}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
          {list.map((i) => (
            <button
              key={i.key}
              title={i.label}
              onClick={() => onChange({ icon: i.key, iconColor: undefined })}
              style={{ cursor: "pointer", padding: "6px 2px", borderRadius: 8, background: style.icon === i.key ? "rgba(212,175,55,.2)" : "rgba(255,255,255,.04)", border: `1px solid ${style.icon === i.key ? HUD.gold : HUD.border}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}
            >
              <span style={{ width: 24, height: 24, borderRadius: "50%", background: i.color, display: "flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: iconSvg(i.key, "#fff", 14) }} />
              <span style={{ fontSize: 8.5, color: HUD.textSecondary, lineHeight: 1.1, textAlign: "center" }}>{i.label}</span>
            </button>
          ))}
        </div>
      </Row>
      <Colour title="Icon colour" value={style.iconColor ?? def.color} onChange={(c) => onChange({ iconColor: c })} />
      <Slider title="Icon size" value={style.iconSize ?? 38} min={20} max={72} onChange={(v) => onChange({ iconSize: v })} unit=" px" />
      <Row title="Label">
        <input value={style.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder={def.label} style={inputStyle} />
        <label style={{ fontSize: 11, color: HUD.textSecondary, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={style.labelOn !== false} onChange={(e) => onChange({ labelOn: e.target.checked })} />
          Show the label on the map
        </label>
      </Row>
    </>
  );
}

// ── Import ──────────────────────────────────────────────────────────────

function ImportTab({ files, onDone }: { files: File[] | null; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Imported | null>(null);
  const [name, setName] = useState("");
  const [size, setSize] = useState<{ bytes: number; simplified: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);

  async function load(list: File[]) {
    if (!list.length) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await importGeoFiles(list);
      setRes(r);
      setName(r.name);
      const fit = fitLayerToSize(r.fc);
      setSize({ bytes: fit.bytes, simplified: fit.simplified });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read those files.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (files?.length) {
      void load(files);
      studio.set({ dropped: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  async function add() {
    if (!res) return;
    setSaving(true);
    const fit = fitLayerToSize(res.fc);
    const row = await createShape(fit.fc, { name: name.trim() || res.name, style: { ...studio.get().draft }, source: res.source as ShapeSource });
    setSaving(false);
    if (row) {
      studio.set({ selectedId: row.id });
      studio.zoomTo(row.id);
      setRes(null);
      onDone();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void load(Array.from(e.dataTransfer.files));
        }}
        onClick={() => input.current?.click()}
        style={{ cursor: "pointer", textAlign: "center", padding: "18px 10px", borderRadius: 10, border: `1.5px dashed ${over ? HUD.goldLight : HUD.borderStrong}`, background: over ? "rgba(212,175,55,.1)" : "rgba(255,255,255,.02)", color: HUD.textSecondary, fontSize: 12 }}
      >
        <FileUp size={22} color={HUD.gold} style={{ marginBottom: 4 }} />
        <div style={{ fontWeight: 600, color: HUD.text }}>{busy ? "Reading…" : "Drop files here or click to choose"}</div>
        <div style={{ fontSize: 10, color: HUD.textMuted, marginTop: 4 }}>{FORMATS}</div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (void load(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      </div>
      <div style={{ fontSize: 10, color: HUD.textMuted }}>For a shapefile, choose the .zip, or the .shp together with its .dbf and .prj files. You can also drop files straight onto the map.</div>
      {err && <div style={{ fontSize: 11, color: HUD.red }}>{err}</div>}
      {res && (
        <div style={{ ...glass({ borderRadius: 10 }), padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: HUD.text, fontWeight: 600 }}>
            {res.fc.features.length} feature{res.fc.features.length === 1 ? "" : "s"} found
          </div>
          <div style={{ fontSize: 11, color: HUD.textSecondary }}>
            {Object.entries(res.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")} · from {res.source}
            {size?.simplified ? " · simplified to fit" : ""}
          </div>
          {res.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 10.5, color: "#EAB308" }}>{w}</div>
          ))}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Layer name" style={inputStyle} />
          <div style={{ fontSize: 10, color: HUD.textMuted }}>It is drawn with the current style from the Draw tab; change it afterwards if you like.</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...btn(true), flex: 1 }} onClick={add} disabled={saving}>
              <Upload size={13} /> {saving ? "Adding…" : "Add to map"}
            </button>
            <button style={btn()} onClick={() => setRes(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Selected shape ──────────────────────────────────────────────────────

function Selected({ shape }: { shape: SavedShape }) {
  const st = useStudio();
  const over = st.overrides[shape.id] ?? {};
  const style: ShapeStyle = { ...DEFAULT_STYLE, ...shape.style, ...over };
  const name = over.name ?? shape.name;
  const m = useMemo(() => measure(shape.geometry), [shape.geometry]);
  const g = shape.geometry.type === "Feature" ? shape.geometry.geometry : null;
  const isIcon = g?.type === "Point" && (!!shape.style.icon || shape.source === "icon");
  const isLine = m.kind === "length";
  const [km, setKm] = useState(5);
  const [confirm, setConfirm] = useState(false);
  const collection = shape.geometry.type === "FeatureCollection";

  const exportGeo = () => downloadText(`${name.replace(/\W+/g, "_")}.geojson`, JSON.stringify(shape.geometry), "application/geo+json");
  const exportKml = () => downloadText(`${name.replace(/\W+/g, "_")}.kml`, toKml(name, [{ name, geometry: shape.geometry, style }]), "application/vnd.google-earth.kml+xml");

  return (
    <div style={{ ...glass({ borderRadius: 10 }), padding: 10, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input value={name} onChange={(e) => editShape(shape.id, { name: e.target.value })} style={{ ...inputStyle, fontWeight: 600, fontSize: 13 }} />
        <button style={{ ...btn(st.saveState === "saving"), whiteSpace: "nowrap" }} onClick={() => void saveNow()} title="Changes also save by themselves a moment after you stop">
          {st.saveState === "saved" ? <><Check size={12} /> Saved</> : st.saveState === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: HUD.textSecondary, display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
        {m.areaM2 != null && <span>Area {fmtArea(m.areaM2)}</span>}
        {m.perimeterM != null && <span>Perimeter {fmtLength(m.perimeterM)}</span>}
        {m.lengthM != null && <span>Length {fmtLength(m.lengthM)}</span>}
        <span>{m.vertices} points</span>
        {collection && <span>{(shape.geometry as GeoJSON.FeatureCollection).features.length} features</span>}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button style={btn()} onClick={() => studio.zoomTo(shape.id)}><ZoomIn size={12} /> Zoom</button>
        <button style={btn()} onClick={() => void duplicateShape(shape)}><Copy size={12} /> Copy</button>
        <button style={btn()} onClick={exportGeo}><Download size={12} /> GeoJSON</button>
        <button style={btn()} onClick={exportKml}><Download size={12} /> KML</button>
      </div>
      {!isIcon && !isLine && !collection && (
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <button style={btn()} onClick={() => void bufferShape(shape, km)}><Waypoints size={12} /> Buffer</button>
          <input type="number" min={0.1} step={0.5} value={km} onChange={(e) => setKm(Math.max(0.1, Number(e.target.value) || 1))} style={{ ...inputStyle, width: 64 }} />
          <span style={{ fontSize: 11, color: HUD.textMuted }}>km around it</span>
        </div>
      )}
      {isIcon ? <IconPicker style={style} onChange={(p) => editShape(shape.id, p)} /> : <StyleEditor style={style} isIcon={false} isLine={isLine} onChange={(p) => editShape(shape.id, p)} />}
      {collection && <div style={{ fontSize: 10, color: HUD.textMuted }}>The style applies to every feature in this imported layer.</div>}
      <Row title="Notes">
        <textarea value={style.notes ?? ""} onChange={(e) => editShape(shape.id, { notes: e.target.value })} rows={2} placeholder="Add notes…" style={{ ...inputStyle, resize: "vertical" }} />
      </Row>
      {confirm ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button style={btn(false, true)} onClick={() => void removeShape(shape.id)}>Yes, delete</button>
          <button style={btn()} onClick={() => setConfirm(false)}>Keep</button>
        </div>
      ) : (
        <button style={btn(false, true)} onClick={() => setConfirm(true)}><Trash2 size={12} /> Delete</button>
      )}
    </div>
  );
}

// ── Layers ──────────────────────────────────────────────────────────────

function Swatch({ s }: { s: SavedShape }) {
  const st = { ...DEFAULT_STYLE, ...s.style };
  const g = s.geometry.type === "Feature" ? s.geometry.geometry : null;
  if (g?.type === "Point" && (st.icon || s.source === "icon")) {
    const d = iconDef(st.icon);
    return <span style={{ width: 22, height: 22, borderRadius: "50%", background: st.iconColor ?? d.color, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: iconSvg(st.icon, "#fff", 12) }} />;
  }
  return <span style={{ lineHeight: 0, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: previewSvg({ key: (st.pattern as PatternKey) ?? "solid", color: st.patternColor ?? st.color ?? "#38BDF8", size: 6, weight: 1.2, bg: st.fillColor ?? st.color ?? "#38BDF8", bgOpacity: Math.max(0.35, st.fillOpacity ?? 0.3) }, 28, 20) }} />;
}

function LayersTab({ shapes, onEdit }: { shapes: SavedShape[]; onEdit: () => void }) {
  const st = useStudio();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string | null>(null); // an id, or "picked"
  const list = shapes.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  const ids = [...picked].filter((id) => shapes.some((s) => s.id === id));
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const exportAll = (kind: "geojson" | "kml") => {
    const vis = shapes.filter((s) => s.visible);
    const pick = vis.length ? vis : shapes;
    if (kind === "geojson") {
      const features = pick.flatMap((s) => (s.geometry.type === "FeatureCollection" ? s.geometry.features : [s.geometry]).map((f) => ({ ...f, properties: { ...(f.properties ?? {}), layer: s.name, ...(s.style.label ? { label: s.style.label } : {}) } })));
      downloadText("map-studio.geojson", JSON.stringify({ type: "FeatureCollection", features }), "application/geo+json");
    } else {
      downloadText("map-studio.kml", toKml("Map Studio", pick.map((s) => ({ name: s.name, geometry: s.geometry, style: { ...DEFAULT_STYLE, ...s.style } }))), "application/vnd.google-earth.kml+xml");
    }
  };
  const ghost: CSSProperties = { ...btn(), padding: 3, border: "none", background: "none" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${shapes.length} item${shapes.length === 1 ? "" : "s"}…`} style={inputStyle} />
      {shapes.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: HUD.textSecondary }}>
          <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={ids.length > 0 && ids.length === list.length} onChange={(e) => setPicked(e.target.checked ? new Set(list.map((s) => s.id)) : new Set())} />
            {ids.length ? `${ids.length} chosen` : "Choose all"}
          </label>
          {ids.length > 0 && (confirm === "picked" ? (
            <>
              <button style={btn(false, true)} onClick={() => (void removeShapes(ids), setPicked(new Set()), setConfirm(null))}>Delete {ids.length}?</button>
              <button style={btn()} onClick={() => setConfirm(null)}>Keep</button>
            </>
          ) : (
            <button style={btn(false, true)} onClick={() => setConfirm("picked")}><Trash2 size={12} /> Delete chosen</button>
          ))}
        </div>
      )}
      {!list.length && <div style={{ fontSize: 11, color: HUD.textMuted }}>{shapes.length ? "Nothing matches." : "Nothing drawn yet. Pick a tool on the Draw tab, or import a file. Everything you draw is saved automatically."}</div>}
      {list.map((s) => (
        <div
          key={s.id}
          onClick={() => (studio.select(s.id), studio.set({ tool: "select" }))}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: 8, cursor: "pointer", background: st.selectedId === s.id ? "rgba(212,175,55,.14)" : "transparent", border: `1px solid ${st.selectedId === s.id ? HUD.borderStrong : "transparent"}` }}
        >
          <input type="checkbox" checked={picked.has(s.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(s.id)} />
          <Swatch s={s} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: s.visible ? HUD.text : HUD.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.name}>
            {st.overrides[s.id]?.name ?? s.name}
          </span>
          {confirm === s.id ? (
            <>
              <button style={btn(false, true)} onClick={(e) => (e.stopPropagation(), void removeShape(s.id), setConfirm(null))}>Delete?</button>
              <button style={btn()} onClick={(e) => (e.stopPropagation(), setConfirm(null))}>No</button>
            </>
          ) : (
            <>
              <button title="Edit" style={ghost} onClick={(e) => (e.stopPropagation(), studio.select(s.id), studio.set({ tool: "select" }), onEdit())}><Pencil size={13} /></button>
              <button title="Zoom to" style={ghost} onClick={(e) => (e.stopPropagation(), studio.select(s.id), studio.zoomTo(s.id))}><ZoomIn size={13} /></button>
              <button title={s.visible ? "Hide" : "Show"} style={ghost} onClick={(e) => (e.stopPropagation(), void setVisible(s.id, !s.visible))}>{s.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
              <button title="Delete" style={{ ...ghost, color: HUD.red }} onClick={(e) => (e.stopPropagation(), setConfirm(s.id))}><Trash2 size={13} /></button>
            </>
          )}
        </div>
      ))}
      {shapes.length > 0 && (
        <div style={{ display: "flex", gap: 6, paddingTop: 6, borderTop: `1px solid ${HUD.border}` }}>
          <button style={{ ...btn(), flex: 1 }} onClick={() => exportAll("geojson")}><Download size={12} /> Export GeoJSON</button>
          <button style={{ ...btn(), flex: 1 }} onClick={() => exportAll("kml")}><Download size={12} /> Export KML</button>
        </div>
      )}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────

export function StudioPanel({ shapes }: { shapes: SavedShape[] }) {
  const st = useStudio();
  const [tab, setTab] = useState<"draw" | "layers" | "import">("draw");
  const selected = shapes.find((s) => s.id === st.selectedId);
  const tool = TOOLS.find((t) => t.key === st.tool)!;

  useEffect(() => {
    if (st.dropped?.length) setTab("import");
  }, [st.dropped]);
  useEffect(() => {
    if (st.selectedId && tab === "import") setTab("draw");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.selectedId]);
  useEffect(() => {
    if (!st.notice) return;
    const t = setTimeout(() => studio.set({ notice: null }), 6000);
    return () => clearTimeout(t);
  }, [st.notice]);

  const draftIsIcon = st.tool === "icon";
  const tabBtn = (k: typeof tab, text: string, icon: ReactNode) => (
    <button key={k} onClick={() => setTab(k)} style={{ ...btn(tab === k), flex: 1 }}>{icon}{text}</button>
  );

  return (
    <div className="studio-panel" style={{ ...glass(), position: "absolute", top: 12, right: 76, zIndex: 500, width: 318, maxHeight: "calc(100% - 24px)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: HUD.text, fontWeight: 700 }}>Map Studio</div>
        <div style={{ fontSize: 10, color: HUD.textMuted }}>{shapes.length} on map</div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {tabBtn("draw", "Draw", <PenLine size={12} />)}
        {tabBtn("layers", `Layers`, <Layers size={12} />)}
        {tabBtn("import", "Import", <Upload size={12} />)}
      </div>

      {tab === "draw" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
            {TOOLS.map((t) => (
              <button key={t.key} onClick={() => studio.set({ tool: t.key })} title={t.label} style={{ ...btn(st.tool === t.key), flexDirection: "column", padding: "7px 2px", gap: 3, fontSize: 10 }}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: HUD.textSecondary, lineHeight: 1.45 }}>{tool.hint}</div>

          {st.tool === "select" && selected ? (
            <Selected shape={selected} />
          ) : draftIsIcon ? (
            <IconPicker style={st.iconDraft} onChange={(p) => studio.set({ iconDraft: { ...st.iconDraft, ...p } })} />
          ) : st.tool === "select" ? (
            <div style={{ fontSize: 11, color: HUD.textMuted }}>Nothing selected. Click a shape on the map or in the Layers tab.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ ...label, color: HUD.gold }}>Style for the next {st.tool === "line" ? "line" : "shape"}</div>
              <StyleEditor style={st.draft} isIcon={false} isLine={st.tool === "line"} onChange={(p) => studio.set({ draft: { ...st.draft, ...p } })} />
            </div>
          )}
        </>
      )}

      {tab === "layers" && <LayersTab shapes={shapes} onEdit={() => setTab("draw")} />}
      {tab === "import" && <ImportTab files={st.dropped} onDone={() => setTab("layers")} />}

      {st.notice && <div style={{ fontSize: 11, color: HUD.red, border: "1px solid rgba(255,61,61,.35)", borderRadius: 8, padding: "6px 8px" }}>{st.notice}</div>}
    </div>
  );
}
