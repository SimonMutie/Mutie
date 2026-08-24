import type { MonitoringQueryItem } from "../api";
import { api } from "../api";
import CategoryBadge, { categoryMeta } from "./CategoryBadge";

interface Props {
  queries: MonitoringQueryItem[];
  onChanged: () => void;
  onOpen: (queryId: string) => void;
  onNew: () => void;
  onEdit: (queryId: string) => void;
}

export default function QueryList({ queries, onChanged, onOpen, onNew, onEdit }: Props) {
  async function toggleActive(e: React.MouseEvent, q: MonitoringQueryItem) {
    e.stopPropagation();
    await api.updateQuery(q.id, { is_active: !q.is_active });
    onChanged();
  }

  async function remove(e: React.MouseEvent, q: MonitoringQueryItem) {
    e.stopPropagation();
    await api.deleteQuery(q.id);
    onChanged();
  }

  function edit(e: React.MouseEvent, q: MonitoringQueryItem) {
    e.stopPropagation();
    onEdit(q.id);
  }

  return (
    <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div className="eyebrow">YOUR MONITORING QUERIES ({queries.length})</div>
        <button onClick={onNew} style={newBtnStyle}>
          + New query
        </button>
      </div>

      {queries.length === 0 && (
        <div className="panel" style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
          No queries yet.
          <br />
          <button onClick={onNew} style={{ ...newBtnStyle, marginTop: 12 }}>
            + New query
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {queries.map((q) => (
          <div
            key={q.id}
            onClick={() => onOpen(q.id)}
            className="panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 16px",
              cursor: "pointer",
              opacity: q.is_active ? 1 : 0.6,
            }}
          >
            <CategoryBadge category={q.category} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {q.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {categoryMeta(q.category).label} · {q.match_count ?? 0} matches
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: 999,
                flexShrink: 0,
                color: q.is_active ? "var(--signal)" : "var(--text-faint)",
                background: q.is_active ? "color-mix(in srgb, var(--signal) 14%, transparent)" : "transparent",
                border: `1px solid ${q.is_active ? "color-mix(in srgb, var(--signal) 40%, transparent)" : "var(--border)"}`,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: q.is_active ? "var(--signal)" : "var(--text-faint)" }} />
              {q.is_active ? "Live" : "Paused"}
            </span>
            <button onClick={(e) => edit(e, q)} style={smallBtnStyle}>
              Edit
            </button>
            <button onClick={(e) => toggleActive(e, q)} style={smallBtnStyle}>
              {q.is_active ? "Pause" : "Resume"}
            </button>
            <button onClick={(e) => remove(e, q)} style={{ ...smallBtnStyle, color: "var(--critical)" }}>
              Delete
            </button>
            <span style={{ color: "var(--text-faint)", fontSize: 16 }}>→</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 8px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};

const newBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};
