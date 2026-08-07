import { useState } from "react";
import type { MonitoringQueryItem } from "../api";
import { api } from "../api";

interface Props {
  queries: MonitoringQueryItem[];
  matchCounts: Record<string, number>;
  onChanged: () => void;
}

export default function QueryBuilder({ queries, matchCounts, onChanged }: Props) {
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

  async function toggleActive(q: MonitoringQueryItem) {
    await api.updateQuery(q.id, { is_active: !q.is_active });
    onChanged();
  }

  async function remove(q: MonitoringQueryItem) {
    await api.deleteQuery(q.id);
    onChanged();
  }

  return (
    <div className="panel" style={{ padding: "16px 18px", display: "flex", gap: 24, height: "100%" }}>
      <form onSubmit={handleValidateAndSubmit} style={{ flex: "0 0 340px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>NEW MONITORING QUERY</div>
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
        <div className="eyebrow" style={{ marginBottom: 8 }}>ACTIVE MONITORING ({queries.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {queries.map((q) => (
            <div
              key={q.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: "var(--panel-raised)",
                borderRadius: 6,
                border: "1px solid var(--border-soft)",
                opacity: q.is_active ? 1 : 0.5,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: q.is_active ? "var(--signal)" : "var(--text-faint)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {q.name}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {q.boolean_query}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
                {matchCounts[q.id] ?? 0} matches
              </div>
              <button onClick={() => toggleActive(q)} style={smallBtnStyle}>
                {q.is_active ? "Pause" : "Resume"}
              </button>
              <button onClick={() => remove(q)} style={{ ...smallBtnStyle, color: "var(--critical)" }}>
                Delete
              </button>
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
