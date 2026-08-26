import { useEffect, useState } from "react";
import { api, type IncidentItem, type SavedUpload } from "../api";
import IncidentManualEntry from "./IncidentManualEntry";

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

export default function IncidentManageTable({ refreshKey, onChanged }: Props) {
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [uploads, setUploads] = useState<SavedUpload[]>([]);
  const [uploadsDeleting, setUploadsDeleting] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<IncidentItem | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [limit, setLimit] = useState(500);

  async function load() {
    setLoading(true);
    const [rows, uploadRows] = await Promise.all([api.getIncidents({ limit }), api.getIncidentUploads()]);
    setIncidents(rows);
    setUploads(uploadRows);
    setSelected((s) => new Set([...s].filter((id) => rows.some((r) => r.id === id))));
    setLoading(false);
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
          {loading ? "Loading…" : `${incidents.length.toLocaleString()} incidents${incidents.length === limit ? " (showing most recent — increase below to see more)" : ""}`}
        </div>
        {selected.size > 0 && (
          <button onClick={deleteSelected} disabled={bulkDeleting} style={dangerBtnStyle}>
            {bulkDeleting ? "Deleting…" : `Delete ${selected.size} selected`}
          </button>
        )}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border-soft)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--panel-raised)", textAlign: "left" }}>
              <th style={thStyle}>
                <input type="checkbox" checked={incidents.length > 0 && selected.size === incidents.length} onChange={toggleAll} />
              </th>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Sector</th>
              <th style={thStyle}>Actor</th>
              <th style={thStyle}>Severity</th>
              <th style={thStyle}>Casualties</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={i.id} style={{ borderTop: "1px solid var(--border-soft)", background: selected.has(i.id) ? "color-mix(in srgb, var(--signal) 6%, transparent)" : "transparent" }}>
                <td style={tdStyle}>
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} />
                </td>
                <td style={tdStyle}>{i.occurred_date || "—"}</td>
                <td style={tdStyle}>{[i.city, i.province, i.country].filter(Boolean).join(", ") || i.precise_location || "—"}</td>
                <td style={tdStyle}>{i.sector || "—"}</td>
                <td style={tdStyle}>{i.actor || "—"}</td>
                <td style={tdStyle}>{i.severity || "—"}</td>
                <td style={{ ...tdStyle, color: totalCasualties(i) > 0 ? "var(--critical)" : "var(--text-muted)" }}>{totalCasualties(i) || "—"}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <button onClick={() => setEditing(i)} style={smallBtnStyle}>
                    Edit
                  </button>
                  <button onClick={() => deleteOne(i.id)} style={{ ...smallBtnStyle, color: "var(--critical)", marginLeft: 6 }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && incidents.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "var(--text-faint)", padding: "24px 12px" }}>
                  No incidents yet — upload a file or add one manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {incidents.length === limit && (
        <button onClick={() => setLimit((l) => l + 500)} style={{ ...smallBtnStyle, marginTop: 12 }}>
          Load 500 more
        </button>
      )}
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
