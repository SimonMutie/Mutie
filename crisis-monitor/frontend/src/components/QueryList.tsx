import { useState } from "react";
import type { MonitoringQueryItem } from "../api";
import { api } from "../api";
import CategoryBadge, { categoryMeta } from "./CategoryBadge";

interface Props {
  queries: MonitoringQueryItem[];
  onChanged: () => void;
  onOpen: (queryId: string) => void;
}

export default function QueryList({ queries, onChanged, onOpen }: Props) {
  const [name, setName] = useState("");
  const [booleanQuery, setBooleanQuery] = useState("");
  const [category, setCategory] = useState("general");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleValidateAndSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !booleanQuery.trim()) {
      setError("Name and query are both required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const check = await api.validateQuery(booleanQuery);
      if (!check.valid) {
        setError(check.error ?? "Invalid boolean query");
        setSubmitting(false);
        return;
      }
      await api.createQuery({ name, boolean_query: booleanQuery, category });
      setName("");
      setBooleanQuery("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create query");
    } finally {
      setSubmitting(false);
    }
  }

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

  return (
    <div style={{ flex: 1, display: "flex", gap: 24, padding: 24, minHeight: 0 }}>
      <form
        onSubmit={handleValidateAndSubmit}
        className="panel"
        style={{ flex: "0 0 340px", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8, height: "fit-content" }}
      >
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          NEW MONITORING QUERY
        </div>
        <input
          placeholder="Query name (e.g. Flooding — East Africa)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
        <textarea
          placeholder={`Boolean query, e.g.\n("flood" OR "landslide") AND "evacuat*" NOT "drill"`}
          value={booleanQuery}
          onChange={(e) => setBooleanQuery(e.target.value)}
          rows={3}
          style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12.5, resize: "vertical" }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
          <option value="general">General</option>
          <option value="public_health">Public health</option>
          <option value="civil_unrest">Civil unrest</option>
          <option value="infrastructure">Infrastructure</option>
          <option value="natural_disaster">Natural disaster</option>
          <option value="cyber">Cyber</option>
        </select>
        {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 4,
            padding: "8px 14px",
            background: "var(--signal-dim)",
            border: "1px solid var(--signal)",
            color: "var(--text-primary)",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {submitting ? "Adding…" : "Add query"}
        </button>
      </form>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          YOUR MONITORING QUERIES ({queries.length})
        </div>
        {queries.length === 0 && (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "12px 4px" }}>
            No queries yet — create one on the left to start a live dashboard for it.
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
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: q.is_active ? "var(--signal)" : "var(--text-faint)",
                  }}
                />
                {q.is_active ? "Live" : "Paused"}
              </span>
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
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};

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
