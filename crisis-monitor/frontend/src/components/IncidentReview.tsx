import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { api, type IncidentRow, type StagedIncident, type StagingBatch, type StagingStatus } from "../api";
import SheetGrid, { type SheetColumn, type SheetEdit } from "./SheetGrid";

/** The analyst's spreadsheet layout, in order. `field` is the database field the app stores; a null field is a
 *  column the app does not collect automatically — it stays blank in the file for the analyst to fill. */
const EXPORT_COLUMNS: { header: string; field: keyof IncidentRow | null }[] = [
  ["Date", "date"], ["Time", "time"], ["Country", "country"], ["Province", "province"], ["County", "county"], ["District", "district"],
  ["City", "city"], ["Suburb", "suburb"], ["Precise Location", "precise_location"], ["Latitude", "latitude"], ["Longitude", "longitude"],
  ["Sector", "sector"], ["Actor", "actor"], ["Operation", "operation"], ["Tactic", "tactic"], ["Severity", "severity"], ["Details", "details"],
  ["Target", "target"], ["Interest Group", "interest_group"], ["Actual Main Victim", "actual_main_victim"],
  ["Civilian Death - 1006", null], ["Civilian Death - 1117", null], ["Civilian Death - Child", "civilian_death_child"], ["Civilian Death - Child-nationality", null],
  ["Civilian Death - Country Of Origin", null], ["Civilian Death - Female", "civilian_death_female"], ["Civilian Death - Female-nationality", null],
  ["Civilian Death - Foreign-national", null], ["Civilian Death - Foreign-national-nationality", null], ["Civilian Death - Male", "civilian_death_male"],
  ["Civilian Death - Male-nationality", null], ["Civilian Death - Unknown", "civilian_death_unknown"], ["Civilian Death - Unknown-nationality", null],
  ["Civilian Injury - 1047", null], ["Civilian Injury - 109", null], ["Civilian Injury - 1158", null], ["Civilian Injury - 1224", null],
  ["Civilian Injury - Child", null], ["Civilian Injury - Child-nationality", null], ["Civilian Injury - Country Of Origin", null],
  ["Civilian Injury - Female", "civilian_injury_female"], ["Civilian Injury - Female-nationality", null], ["Civilian Injury - Foreign-national", null],
  ["Civilian Injury - Foreign-national-nationality", null], ["Civilian Injury - Male", "civilian_injury_male"], ["Civilian Injury - Male-nationality", null],
  ["Civilian Injury - Unknown", "civilian_injury_unknown"], ["Civilian Injury - Unknown-nationality", null],
  ...["17", "Ap", "Ap-nationality", "Gok-civ", "Gok-civ-nationality", "Gok-police", "Gok-police-nationality", "Gok-secfor", "Gok-secfor-nationality", "Gsu", "Gsu-nationality", "Hasm", "Hasm-nationality", "Kpr", "Kpr-nationality", "Kws", "Kws-nationality", "Myc"].map((k) => [`Combatant Death - ${k}`, null] as [string, null]),
  ...["17", "Ap", "Ap-nationality", "Gok-civ", "Gok-civ-nationality", "Gok-police", "Gok-police-nationality", "Gok-secfor", "Gok-secfor-nationality", "Gsu", "Gsu-nationality", "Hasm", "Kpr", "Kpr-nationality", "Kws", "Kws-nationality", "Media", "Media-nationality"].map((k) => [`Combatant Injury - ${k}`, null] as [string, null]),
  ["Intended Primary Target", "intended_primary_target"], ["Kidnappings - Case #", null],
  ...["Civilian", "Civilian-nationality", "Duration (days)", "Gok-civ", "Gok-civ-nationality", "Gok-sf", "Myc", "Myc-nationality", "Nationality (ngo Only)"].map((k) => [`Kidnappings - ${k}`, null] as [string, null]),
  ["Kidnappings - Ngo", "kidnappings_ngo"], ["Kidnappings - Political", null], ["Kidnappings - Status", null],
  ["Other Death - Diplomatic", null], ["Other Death - Politician", null], ["Other Death - Un", null],
].map(([header, field]) => ({ header: header as string, field: field as keyof IncidentRow | null }));

function exportBatch(date: string, items: StagedIncident[]) {
  const data = items.map((it) => {
    const out: Record<string, unknown> = {};
    for (const col of EXPORT_COLUMNS) out[col.header] = col.field ? (it.row[col.field] ?? "") : "";
    out["Source URL"] = it.source_url ?? "";
    out["Source"] = it.source_domain ?? "";
    out["Confidence"] = it.confidence ?? "";
    out["Location precision"] = it.geo_precision ?? "";
    out["Review status"] = it.status;
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: [...EXPORT_COLUMNS.map((c) => c.header), "Source URL", "Source", "Confidence", "Location precision", "Review status"] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Incidents");
  XLSX.writeFile(wb, `incidents-${date}.xlsx`);
}

const EDIT_FIELDS: (SheetColumn & { key: keyof IncidentRow })[] = [
  { key: "date", label: "Date", width: 96 }, { key: "time", label: "Time", width: 64 }, { key: "country", label: "Country", width: 100 },
  { key: "province", label: "Province", width: 100 }, { key: "county", label: "County", width: 100 }, { key: "district", label: "District", width: 100 },
  { key: "city", label: "City", width: 100 }, { key: "suburb", label: "Suburb", width: 90 }, { key: "precise_location", label: "Precise location", width: 140 },
  { key: "latitude", label: "Lat", width: 76, num: true }, { key: "longitude", label: "Lon", width: 76, num: true },
  { key: "sector", label: "Sector", width: 100 }, { key: "actor", label: "Actor", width: 130 }, { key: "operation", label: "Operation", width: 110 },
  { key: "tactic", label: "Tactic", width: 120 }, { key: "severity", label: "Severity", width: 80 }, { key: "target", label: "Target", width: 110 },
  { key: "interest_group", label: "Interest group", width: 120 }, { key: "actual_main_victim", label: "Main victim", width: 110 },
  { key: "intended_primary_target", label: "Intended target", width: 120 },
  { key: "civilian_death_male", label: "Deaths: men", width: 80, num: true }, { key: "civilian_death_female", label: "Deaths: women", width: 80, num: true },
  { key: "civilian_death_child", label: "Deaths: children", width: 80, num: true }, { key: "civilian_death_unknown", label: "Deaths: unknown", width: 80, num: true },
  { key: "civilian_injury_male", label: "Injured: men", width: 80, num: true }, { key: "civilian_injury_female", label: "Injured: women", width: 80, num: true },
  { key: "civilian_injury_unknown", label: "Injured: unknown", width: 80, num: true }, { key: "kidnappings_ngo", label: "NGO kidnappings", width: 80, num: true },
  { key: "details", label: "Details", width: 320 },
];

const STATUS_COLOR: Record<StagingStatus, string> = { pending: "#a16207", approved: "#166534", rejected: "#991b1b", pushed: "#475569" };

export default function IncidentReview({ onPushed }: { onPushed: () => void }) {
  const [batches, setBatches] = useState<StagingBatch[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [items, setItems] = useState<StagedIncident[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<StagingStatus | "all">("all");

  const loadBatches = useCallback(async () => {
    const b = await api.stagingBatches();
    setBatches(b);
    setDate((d) => d ?? b[0]?.batch_date ?? null);
  }, []);
  useEffect(() => { loadBatches().catch((e) => setMessage(String(e.message ?? e))); }, [loadBatches]);
  useEffect(() => {
    if (!date) { setItems([]); return; }
    api.stagingList(date).then(setItems).catch((e) => setMessage(String(e.message ?? e)));
  }, [date]);

  const shown = useMemo(() => items.filter((i) => filter === "all" || i.status === filter), [items, filter]);
  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, pushed: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setMessage(null);
    try { await fn(); if (done) setMessage(done); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const reload = async () => { await loadBatches(); if (date) setItems(await api.stagingList(date)); };

  function setStatus(it: StagedIncident, status: StagingStatus) {
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, status } : x)));
    api.stagingPatch(it.id, { status }).catch((e) => setMessage(String(e.message ?? e)));
  }
  /** Edits from the grid: typing updates the screen; a finished edit or a fill is also saved. */
  function applyEdits(edits: SheetEdit[], persist: boolean) {
    const byId = new Map<string, Record<string, string | number | null>>();
    for (const e of edits) byId.set(e.id, { ...(byId.get(e.id) ?? {}), [e.key]: e.value });
    setItems((prev) => prev.map((x) => (byId.has(x.id) ? { ...x, row: { ...x.row, ...byId.get(x.id) } } : x)));
    if (persist) {
      for (const [id, row] of byId) api.stagingPatch(id, { row: row as Partial<IncidentRow> }).catch((e) => setMessage(String(e.message ?? e)));
    }
  }
  const pendingIds = items.filter((i) => i.status === "pending").map((i) => i.id);

  const btn = { padding: "5px 11px", fontSize: 12, cursor: "pointer", border: "1px solid #bbb", background: "#f6f6f6", borderRadius: 4 } as const;

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <select value={date ?? ""} onChange={(e) => setDate(e.target.value || null)} style={{ padding: 4 }}>
          {batches.length === 0 && <option value="">No collections yet</option>}
          {batches.map((b) => (
            <option key={b.batch_date} value={b.batch_date}>{b.batch_date} — {b.total} found, {b.pending} to review</option>
          ))}
        </select>
        <button style={btn} disabled={busy} onClick={() => run(async () => { const r = await api.stagingCollect(24); await loadBatches(); setDate(r.batchDate); setItems(await api.stagingList(r.batchDate)); setMessage(r.staged ? `${r.staged} new incident${r.staged === 1 ? "" : "s"} collected.` : "Nothing new in the last 24 hours."); })}>
          Collect now
        </button>
        <button style={btn} disabled={!date || items.length === 0} onClick={() => date && exportBatch(date, items)}>Download Excel</button>
        <span style={{ flex: 1 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as StagingStatus | "all")} style={{ padding: 4 }}>
          <option value="all">All ({items.length})</option>
          <option value="pending">To review ({counts.pending})</option>
          <option value="approved">Approved ({counts.approved})</option>
          <option value="rejected">Rejected ({counts.rejected})</option>
          <option value="pushed">In database ({counts.pushed})</option>
        </select>
      </div>

      <div style={{ color: "#555", marginBottom: 8, lineHeight: 1.45 }}>
        New online reports are collected once a day from the platform's news monitoring, located on the map, and kept here. Nothing goes into your incident database until you approve it and press Push. Columns the reporting can't supply (casualty breakdowns, kidnappings, sector…) are left blank for you.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <button style={btn} disabled={busy || pendingIds.length === 0} onClick={() => run(async () => { await api.stagingSetStatus(pendingIds, "approved"); await reload(); })}>Approve all to-review ({pendingIds.length})</button>
        <button
          style={{ ...btn, background: counts.approved ? "#166534" : "#f6f6f6", color: counts.approved ? "#fff" : "#888", borderColor: "#166534" }}
          disabled={busy || counts.approved === 0 || !date}
          onClick={() => {
            if (!window.confirm(`Push ${counts.approved} approved incident${counts.approved === 1 ? "" : "s"} into the database?`)) return;
            run(async () => { const r = await api.stagingPush(date ?? undefined); await reload(); onPushed(); setMessage(`${r.pushed} incident${r.pushed === 1 ? "" : "s"} pushed to the database.`); });
          }}
        >
          Push {counts.approved} approved to database
        </button>
      </div>
      {message && <div style={{ margin: "6px 0", color: "#0b5" }}>{message}</div>}

      <SheetGrid
        rows={shown}
        rowId={(it) => it.id}
        columns={EDIT_FIELDS}
        getValue={(it, key) => it.row[key as keyof IncidentRow] as string | number | null | undefined}
        onEdit={applyEdits}
        isLocked={(it) => it.status === "pushed"}
        rowStyle={(it) => ({ opacity: it.status === "rejected" ? 0.5 : 1 })}
        maxHeight="58vh"
        empty={date ? "Nothing here." : "No collections yet — press “Collect now”."}
        lead={{
          header: "Review",
          width: 90,
          cell: (it) =>
            it.status === "pushed" ? (
              <span style={{ color: STATUS_COLOR.pushed }}>In database</span>
            ) : (
              <>
                <button title="Approve" style={{ ...btn, padding: "2px 7px", background: it.status === "approved" ? "#166534" : "#f6f6f6", color: it.status === "approved" ? "#fff" : "#166534" }} onClick={() => setStatus(it, it.status === "approved" ? "pending" : "approved")}>✓</button>{" "}
                <button title="Reject" style={{ ...btn, padding: "2px 7px", background: it.status === "rejected" ? "#991b1b" : "#f6f6f6", color: it.status === "rejected" ? "#fff" : "#991b1b" }} onClick={() => setStatus(it, it.status === "rejected" ? "pending" : "rejected")}>✕</button>
              </>
            ),
        }}
        tail={{
          header: "Source",
          width: 120,
          cell: (it) => (it.source_url ? <a href={it.source_url} target="_blank" rel="noreferrer">{it.source_domain ?? "link"}</a> : "—"),
        }}
      />
    </div>
  );
}
