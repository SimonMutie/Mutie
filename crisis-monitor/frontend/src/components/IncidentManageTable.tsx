import { useEffect, useState } from "react";
import { api, type IncidentItem, type SavedUpload } from "../api";
import IncidentManualEntry from "./IncidentManualEntry";
import SheetGrid, { type SheetColumn, type SheetEdit } from "./SheetGrid";

interface Props {
  refreshKey: number;
  onChanged: () => void;
}

function totalCasualties(i: IncidentItem): number {
  return (
    (i.civilian_death_child ?? 0) +
    (i.civilian_death_female ?? 0) +
    (i.civilian_death_male ?? 0) +
    (i.civilian_death_unknown ?? 0) +
    (i.civilian_injury_female ?? 0) +
    (i.civilian_injury_male ?? 0) +
    (i.civilian_injury_unknown ?? 0)
  );
}

const GRID_COLUMNS: SheetColumn[] = [
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
/** The grid's "date" and "time" are stored as occurred_date / occurred_time on a loaded row. */
const LOCAL_KEY: Record<string, string> = { date: "occurred_date", time: "occurred_time" };

export default function IncidentManageTable({ refreshKey, onChanged }: Props) {
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [uploads, setUploads] = useState<SavedUpload[]>([]);
  const [uploadsDeleting, setUploadsDeleting] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<IncidentItem | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [limit, setLimit] = useState(250000);
  const [visibleRows, setVisibleRows] = useState<IncidentItem[]>([]);

  async function load() {
    setLoading(true);
    const [rows, uploadRows] = await Promise.all([api.getIncidents({ limit }), api.getIncidentUploads()]);
    setIncidents(rows);
    setUploads(uploadRows);
    setSelected((s) => new Set([...s].filter((id) => rows.some((r) => r.id === id))));
    setLoading(false);
  }

  /** Edits from the grid: shown on screen here, stored by saveEdits when the person saves them. */
  function applyEdits(edits: SheetEdit[]) {
    const byId = new Map<string, Record<string, string | number | null>>();
    for (const e of edits) byId.set(e.id, { ...(byId.get(e.id) ?? {}), [e.key]: e.value });
    setIncidents((prev) =>
      prev.map((x) => {
        const ch = byId.get(x.id);
        if (!ch) return x;
        const local: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(ch)) local[LOCAL_KEY[k] ?? k] = v;
        return { ...x, ...local } as IncidentItem;
      }),
    );
  }
  async function saveEdits(edits: SheetEdit[]) {
    const byId = new Map<string, Record<string, string | number | null>>();
    for (const e of edits) byId.set(e.id, { ...(byId.get(e.id) ?? {}), [e.key]: e.value });
    const entries = [...byId.entries()];
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(entries.slice(i, i + 8).map(([id, patch]) => api.updateIncident(id, patch as never)));
    }
    onChanged();
  }

  async function deleteUpload(upload: SavedUpload) {
    if (!window.confirm(`Delete the entire "${upload.label}" upload — all ${upload.row_count.toLocaleString()} incidents from it? This can't be undone.`)) return;
    setUploadsDeleting((s) => new Set(s).add(upload.id));
    try {
      await api.deleteIncidentBatch(upload.id);
      setUploads((u) => u.filter((x) => x.id !== upload.id));
      await load();
      onChanged();
    } finally {
      setUploadsDeleting((s) => {
        const next = new Set(s);
        next.delete(upload.id);
        return next;
      });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, limit]);

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => (s.size === incidents.length ? new Set() : new Set(incidents.map((i) => i.id))));
  }

  async function deleteOne(id: string) {
    if (!window.confirm("Delete this incident? This can't be undone.")) return;
    await api.deleteIncident(id);
    setIncidents((rows) => rows.filter((r) => r.id !== id));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    onChanged();
  }

  async function deleteSelected() {
    const count = selected.size;
    if (count === 0) return;
    if (!window.confirm(`Delete ${count} selected incident${count === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBulkDeleting(true);
    try {
      await api.bulkDeleteIncidents([...selected]);
      setIncidents((rows) => rows.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
      onChanged();
    } finally {
      setBulkDeleting(false);
    }
  }

  if (editing) {
    return (
      <div>
        <button
          onClick={() => setEditing(null)}
          style={{ fontSize: 12.5, padding: "5px 10px", background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", marginBottom: 16 }}
        >
          ← Back to list
        </button>
        <IncidentManualEntry
          existingIncident={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged();
          }}
        />
      </div>
    );
  }

  return (
    <div>
      {uploads.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>UPLOADED FILES ({uploads.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {uploads.map((u) => (
              <div
                key={u.id}
                className="panel"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {u.row_count.toLocaleString()} incidents · uploaded {new Date(u.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => deleteUpload(u)} disabled={uploadsDeleting.has(u.id)} style={dangerBtnStyle}>
                  {uploadsDeleting.has(u.id) ? "Deleting…" : "Delete entire upload"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {loading ? "Loading every incident…" : `${incidents.length.toLocaleString()} incidents loaded`}
        </div>
        {selected.size > 0 && (
          <button onClick={deleteSelected} disabled={bulkDeleting} style={dangerBtnStyle}>
            {bulkDeleting ? "Deleting…" : `Delete ${selected.size} selected`}
          </button>
        )}
      </div>

      <SheetGrid
        rows={incidents}
        rowId={(i) => i.id}
        columns={GRID_COLUMNS}
        getValue={(i, key) => (i as unknown as Record<string, string | number | null | undefined>)[LOCAL_KEY[key] ?? key]}
        onEdit={applyEdits}
        onSave={saveEdits}
        onVisible={setVisibleRows}
        rowStyle={(i) => ({ background: selected.has(i.id) ? "color-mix(in srgb, var(--signal) 6%, transparent)" : "transparent" })}
        maxHeight="62vh"
        empty="No incidents yet — upload a file or add one manually."
        lead={{
          header: <input type="checkbox" title="Select every row the filters show" checked={visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id))} onChange={() => setSelected((s) => (visibleRows.every((r) => s.has(r.id)) ? new Set() : new Set(visibleRows.map((r) => r.id))))} />,
          width: 34,
          cell: (i) => <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} />,
        }}
        tail={{
          header: "",
          width: 120,
          cell: (i) => (
            <>
              <button onClick={() => setEditing(i)} style={smallBtnStyle}>
                Edit
              </button>
              <button onClick={() => deleteOne(i.id)} style={{ ...smallBtnStyle, color: "var(--critical)", marginLeft: 6 }}>
                Delete
              </button>
            </>
          ),
        }}
      />

    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "var(--text-primary)",
};

const smallBtnStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: "4px 9px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text-muted)",
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "7px 14px",
  background: "color-mix(in srgb, var(--critical) 10%, transparent)",
  border: "1px solid var(--critical)",
  borderRadius: 6,
  color: "var(--critical)",
  cursor: "pointer",
  fontWeight: 600,
};
