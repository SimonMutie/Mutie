import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import L, { type Map as LeafletMap } from "leaflet";
import { Popup as GlPopup, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import { api, type Scenario, type ScenarioInput, type ScenarioLikelihood } from "../api";
import { UNDER } from "../components/globeExtras";
import { useStrategic } from "./store";

/**
 * Scenarios: analysts' questions about how a situation could develop ("Will the SAF retake El Fasher by mid-2027?"),
 * as numbered markers. Click one for the assessment, likelihood, time horizon, indicators to watch and outlook.
 * Admins add, edit and delete them; a new one starts at the centre of the map.
 */

export const LIKELIHOOD: Record<ScenarioLikelihood, { label: string; range: string; color: string }> = {
  remote: { label: "Remote chance", range: "under 5%", color: "#6b7b8f" },
  "highly-unlikely": { label: "Highly unlikely", range: "10–20%", color: "#7f93ab" },
  unlikely: { label: "Unlikely", range: "25–35%", color: "#9db3cc" },
  "realistic-possibility": { label: "Realistic possibility", range: "40–50%", color: "#e8c65a" },
  likely: { label: "Likely", range: "55–75%", color: "#f29b4b" },
  "highly-likely": { label: "Highly likely", range: "80–90%", color: "#ef6a4a" },
  "almost-certain": { label: "Almost certain", range: "over 95%", color: "#e0413d" },
};

/* ── Data ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

let cache: Scenario[] | null = null;
const subs = new Set<(s: Scenario[]) => void>();
async function reload() {
  const r = await api.getScenarios().catch(() => null);
  if (!r) return;
  cache = r.scenarios;
  subs.forEach((f) => f(r.scenarios));
}
function useScenarios(active: boolean): Scenario[] | null {
  const [s, setS] = useState<Scenario[] | null>(cache);
  useEffect(() => {
    if (!active) return;
    subs.add(setS);
    void reload();
    const t = setInterval(() => void reload(), 10 * 60_000);
    return () => {
      subs.delete(setS);
      clearInterval(t);
    };
  }, [active]);
  return s;
}

/* ── Popup ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const para = (s: string) => esc(s).replace(/\n+/g, "<br/>");

function popupHtml(s: Scenario, canEdit: boolean): string {
  const l = s.likelihood ? LIKELIHOOD[s.likelihood] : null;
  const chip = l ? `<span style="display:inline-block;padding:1px 8px;border-radius:9px;font-size:10.5px;font-weight:800;background:${l.color};color:#0b1220">${esc(l.label.toUpperCase())} · ${esc(l.range)}</span>` : "";
  const sec = (t: string, body: string) => `<div style="margin-top:7px"><div style="font-size:10px;letter-spacing:.08em;font-weight:800;opacity:.65">${t}</div>${body}</div>`;
  const act = (a: string) => `window.dispatchEvent(new CustomEvent('lens-scenario',{detail:{action:'${a}',id:'${s.id}'}}))`;
  const btn = "background:rgba(127,127,127,.18);border:1px solid rgba(127,127,127,.4);border-radius:6px;padding:3px 9px;font-size:11.5px;cursor:pointer;color:inherit";
  return `<div style="max-width:330px;max-height:420px;overflow:auto;font-size:12.5px;line-height:1.45">
    <div style="font-size:10px;letter-spacing:.1em;font-weight:800;opacity:.65">SCENARIO ${s.num}${s.place ? ` · ${esc(s.place.toUpperCase())}` : ""}</div>
    <div style="font-weight:800;font-size:13.5px;margin:3px 0 6px">${esc(s.question)}</div>
    ${chip}${s.horizon ? ` <span style="font-size:11.5px;opacity:.8">${esc(s.horizon)}</span>` : ""}
    ${s.assessment ? sec("ASSESSMENT", `<div>${para(s.assessment)}</div>`) : ""}
    ${s.indicators.length ? sec("INDICATORS TO WATCH", `<ul style="margin:2px 0 0;padding-left:17px">${s.indicators.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`) : ""}
    ${s.outlook ? sec("OUTLOOK", `<div>${para(s.outlook)}</div>`) : ""}
    <div style="margin-top:7px;padding-top:6px;border-top:1px solid rgba(127,127,127,.3);font-size:11px;opacity:.75">Afrilens scenario, updated ${esc(s.updatedAt.slice(0, 10))}</div>
    ${canEdit ? `<div style="margin-top:6px;display:flex;gap:6px"><button style="${btn}" onclick="${esc(act("edit"))}">Edit</button><button style="${btn}" onclick="${esc(act("delete"))}">Delete</button></div>` : ""}
  </div>`;
}

function badge(num: number, px: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  // Dark with a gold ring, so a scenario never reads as a numbered incident circle.
  g.fillStyle = "rgba(10,18,32,0.95)";
  g.strokeStyle = "#d4af37";
  g.lineWidth = px * 0.09;
  g.beginPath();
  g.arc(px / 2, px / 2, px / 2 - g.lineWidth, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#f3d77a";
  g.font = `700 ${Math.round(px * (num > 99 ? 0.36 : 0.46))}px Inter, system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(num), px / 2, px / 2 + px * 0.02);
  return c;
}

/* ── Flat map ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export function useFlatScenarios(map: LeafletMap | null, canEdit: boolean) {
  const { scenarios: on } = useStrategic();
  const list = useScenarios(on);
  useEffect(() => {
    if (!map || !on || !list) return;
    const group = L.layerGroup(
      list.map((s) =>
        L.marker([s.lat, s.lng], {
          zIndexOffset: 600,
          icon: L.divIcon({ className: "", iconSize: [28, 28], iconAnchor: [14, 14], html: `<img src="${badge(s.num, 56).toDataURL()}" width="28" height="28" alt="Scenario ${s.num}" />` }),
        })
          .bindTooltip(esc(s.question), { direction: "top" })
          .bindPopup(popupHtml(s, canEdit), { maxWidth: 350 })
      )
    ).addTo(map);
    return () => {
      group.remove();
    };
  }, [map, on, list, canEdit]);
}

/* ── Globe ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const SRC = "lens-scenarios";
export function GlobeScenarios({ map, canEdit }: { map: MapLibreMap | null; canEdit: boolean }) {
  const { scenarios: on } = useStrategic();
  const list = useScenarios(on);
  const ctx = useRef({ list, canEdit });
  ctx.current = { list, canEdit };
  const popup = useRef<GlPopup | null>(null);
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: "FeatureCollection", features: on && list ? list.map((s) => ({ type: "Feature", properties: { id: s.id, img: `lens-scenario-${s.num}` }, geometry: { type: "Point", coordinates: [s.lng, s.lat] } })) : [] }),
    [on, list]
  );
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      for (const s of list ?? []) {
        const id = `lens-scenario-${s.num}`;
        if (!map.hasImage(id)) map.addImage(id, badge(s.num, 56).getContext("2d")!.getImageData(0, 0, 56, 56), { pixelRatio: 2 });
      }
      const src = map.getSource(SRC) as GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        return;
      }
      // Above the strategic shading and circles, beneath the Lens's markers.
      const before = (map.getStyle().layers ?? []).find((l) => l.id.startsWith("lens-") && !UNDER.some((p) => l.id.startsWith(p)) && !l.id.startsWith("lens-strat-") && !l.id.startsWith("lens-chokepoints") && !l.id.startsWith(SRC))?.id;
      map.addSource(SRC, { type: "geojson", data });
      map.addLayer({ id: `${SRC}-sym`, type: "symbol", source: SRC, layout: { "icon-image": ["get", "img"], "icon-allow-overlap": true, "icon-ignore-placement": true } }, before);
      map.on("click", `${SRC}-sym`, (e: MapLayerMouseEvent) => {
        if (map.queryRenderedFeatures(e.point)[0]?.layer.id !== `${SRC}-sym`) return;
        const s = ctx.current.list?.find((x) => x.id === e.features?.[0]?.properties?.id);
        if (!s) return;
        popup.current?.remove();
        popup.current = new GlPopup({ maxWidth: "350px" }).setLngLat([s.lng, s.lat]).setHTML(popupHtml(s, ctx.current.canEdit)).addTo(map);
      });
      map.on("mouseenter", `${SRC}-sym`, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", `${SRC}-sym`, () => (map.getCanvas().style.cursor = ""));
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [map, data, list]);
  return null;
}

/* ── Editor (admins) ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Opens the editor: a new scenario at the centre of the map, or an existing one to change. */
export const newScenario = () => window.dispatchEvent(new CustomEvent("lens-scenario", { detail: { action: "new" } }));

const field: CSSProperties = { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 6, color: "#e6edf7", padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit" };
const label: CSSProperties = { fontSize: 10, letterSpacing: "0.08em", fontWeight: 800, color: "#8fa3bf", margin: "8px 0 3px", display: "block" };

export function ScenarioEditor({ canEdit, center }: { canEdit: boolean; center: () => [number, number] | null }) {
  const [draft, setDraft] = useState<(ScenarioInput & { id?: string; indicatorsText: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;
  useEffect(() => {
    if (!canEdit) return;
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ action: "new" | "edit" | "delete"; id?: string }>).detail;
      const s = cache?.find((x) => x.id === d.id);
      if (d.action === "new") {
        const [lat, lng] = centerRef.current() ?? [8, 25];
        setDraft({ question: "", lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)), place: "", likelihood: null, horizon: "", assessment: "", indicators: [], indicatorsText: "", outlook: "" });
      } else if (d.action === "edit" && s) {
        setDraft({ ...s, indicatorsText: s.indicators.join("\n") });
      } else if (d.action === "delete" && s && window.confirm(`Delete scenario ${s.num}: “${s.question}”?`)) {
        void api.deleteScenario(s.id).then(reload);
      }
      setErr(null);
    };
    window.addEventListener("lens-scenario", h);
    return () => window.removeEventListener("lens-scenario", h);
  }, [canEdit]);
  if (!draft) return null;
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  async function save() {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    const body: ScenarioInput = {
      question: draft.question.trim(),
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      place: draft.place?.trim() || null,
      likelihood: draft.likelihood || null,
      horizon: draft.horizon?.trim() || null,
      assessment: draft.assessment?.trim() || null,
      indicators: draft.indicatorsText.split("\n").map((s) => s.trim()).filter(Boolean),
      outlook: draft.outlook?.trim() || null,
      ...(draft.num ? { num: draft.num } : {}),
    };
    try {
      if (draft.id) await api.updateScenario(draft.id, body);
      else await api.createScenario(body);
      await reload();
      setDraft(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 900, background: "rgba(2,6,14,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDraft(null)}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 92%)", maxHeight: "88%", overflow: "auto", background: "#0b1626", border: "1px solid rgba(159,200,240,0.25)", borderRadius: 12, padding: "14px 16px", color: "#e6edf7", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{draft.id ? `Scenario ${draft.num}` : "New scenario"}</div>
        <span style={label}>QUESTION</span>
        <input style={field} value={draft.question} maxLength={300} placeholder="Will Al-Shabaab retake Mogadishu's outskirts in 2027?" onChange={(e) => set({ question: e.target.value })} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr 70px", gap: 8 }}>
          <div>
            <span style={label}>LATITUDE</span>
            <input style={field} type="number" step="any" value={draft.lat} onChange={(e) => set({ lat: Number(e.target.value) })} />
          </div>
          <div>
            <span style={label}>LONGITUDE</span>
            <input style={field} type="number" step="any" value={draft.lng} onChange={(e) => set({ lng: Number(e.target.value) })} />
          </div>
          <div>
            <span style={label}>PLACE</span>
            <input style={field} value={draft.place ?? ""} maxLength={120} placeholder="Mogadishu" onChange={(e) => set({ place: e.target.value })} />
          </div>
          <div>
            <span style={label}>NUMBER</span>
            <input style={field} type="number" min={1} value={draft.num ?? ""} placeholder="auto" onChange={(e) => set({ num: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <span style={label}>LIKELIHOOD</span>
            <select style={field} value={draft.likelihood ?? ""} onChange={(e) => set({ likelihood: (e.target.value || null) as ScenarioLikelihood | null })}>
              <option value="" style={{ background: "#0b1626" }}>Not given</option>
              {(Object.keys(LIKELIHOOD) as ScenarioLikelihood[]).map((k) => (
                <option key={k} value={k} style={{ background: "#0b1626" }}>
                  {LIKELIHOOD[k].label} ({LIKELIHOOD[k].range})
                </option>
              ))}
            </select>
          </div>
          <div>
            <span style={label}>TIME HORIZON</span>
            <input style={field} value={draft.horizon ?? ""} maxLength={80} placeholder="By end-2027" onChange={(e) => set({ horizon: e.target.value })} />
          </div>
        </div>
        <span style={label}>ASSESSMENT</span>
        <textarea style={{ ...field, minHeight: 90, resize: "vertical" }} value={draft.assessment ?? ""} maxLength={4000} onChange={(e) => set({ assessment: e.target.value })} />
        <span style={label}>INDICATORS TO WATCH (ONE PER LINE)</span>
        <textarea style={{ ...field, minHeight: 64, resize: "vertical" }} value={draft.indicatorsText} onChange={(e) => set({ indicatorsText: e.target.value })} />
        <span style={label}>OUTLOOK</span>
        <textarea style={{ ...field, minHeight: 56, resize: "vertical" }} value={draft.outlook ?? ""} maxLength={2000} onChange={(e) => set({ outlook: e.target.value })} />
        {err && <div style={{ marginTop: 8, color: "#ff8f7a", fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={() => setDraft(null)} style={{ ...field, width: "auto", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => void save()} disabled={busy || draft.question.trim().length < 3} style={{ ...field, width: "auto", cursor: "pointer", background: "rgba(159,200,240,0.22)", borderColor: "rgba(159,200,240,0.6)", fontWeight: 700 }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
