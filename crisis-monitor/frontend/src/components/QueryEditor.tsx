import { useEffect, useRef, useState } from "react";
import { api, ApiError, type MonitoringQueryItem, type PreviewMatch } from "../api";
import CategoryBadge, { categoryMeta } from "./CategoryBadge";

interface Props {
  mode: "create" | "edit";
  /** Required when mode === "edit". */
  existingQuery?: MonitoringQueryItem;
  onSaved: (query: MonitoringQueryItem) => void;
  onCancel: () => void;
}

const CATEGORIES = ["general", "public_health", "civil_unrest", "infrastructure", "natural_disaster", "cyber"];
const PREVIEW_DEBOUNCE_MS = 600;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; scanned: number; lookbackHours: number; truncated: boolean; matches: PreviewMatch[] };

export default function QueryEditor({ mode, existingQuery, onSaved, onCancel }: Props) {
  const [name, setName] = useState(existingQuery?.name ?? "");
  const [category, setCategory] = useState(existingQuery?.category ?? "general");
  const [booleanQuery, setBooleanQuery] = useState(existingQuery?.boolean_query ?? "");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  // Debounced live preview: re-run against recent events shortly after typing stops.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = booleanQuery.trim();
    if (!query) {
      setPreview({ status: "idle" });
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeq.current;
      setPreview({ status: "loading" });
      try {
        const result = await api.previewQuery(query);
        if (seq !== requestSeq.current) return; // a newer keystroke's request has since landed
        setPreview({
          status: "ready",
          scanned: result.scanned,
          lookbackHours: result.lookback_hours,
          truncated: result.truncated,
          matches: result.matches,
        });
      } catch (err) {
        if (seq !== requestSeq.current) return;
        const message = err instanceof ApiError ? err.message : "Couldn't check this query";
        setPreview({ status: "error", message });
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [booleanQuery]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !booleanQuery.trim()) {
      setSaveError("Name and query are both required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const check = await api.validateQuery(booleanQuery);
      if (!check.valid) {
        setSaveError(check.error ?? "Invalid boolean query");
        setSaving(false);
        return;
      }
      const saved =
        mode === "edit" && existingQuery
          ? await api.updateQuery(existingQuery.id, { name, boolean_query: booleanQuery, category })
          : await api.createQuery({ name, boolean_query: booleanQuery, category });
      onSaved(saved);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save query");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <form onSubmit={handleSave} style={{ flex: "0 0 440px", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-soft)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" onClick={onCancel} style={backBtnStyle}>
            ← Cancel
          </button>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{mode === "edit" ? "Edit query" : "New query"}</div>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input
              placeholder="e.g. Sudan Conflict"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              autoFocus
            />
          </div>

          <div>
            <label style={labelStyle}>Category</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px 5px 5px",
                    borderRadius: 999,
                    border: `1px solid ${category === c ? "var(--signal)" : "var(--border)"}`,
                    background: category === c ? "var(--signal-dim)" : "var(--panel)",
                    color: "var(--text-primary)",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  <CategoryBadge category={c} size={18} />
                  {categoryMeta(c).label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 160 }}>
            <label style={labelStyle}>Boolean query</label>
            <textarea
              placeholder={`("flood" OR "landslide") AND "evacuat*" NOT "drill"\n\nSupports AND / OR / NOT, "phrases", word*, w?rd, NEAR/n, title:, topDomain:, url:, titleCharCount:[..]`}
              value={booleanQuery}
              onChange={(e) => setBooleanQuery(e.target.value)}
              style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)", fontSize: 12.5, resize: "none", lineHeight: 1.5 }}
            />
          </div>

          {saveError && (
            <div style={{ fontSize: 12.5, color: "var(--critical)", background: "color-mix(in srgb, var(--critical) 8%, transparent)", padding: "8px 10px", borderRadius: 6 }}>
              {saveError}
            </div>
          )}

          <button type="submit" disabled={saving} style={saveBtnStyle}>
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create query"}
          </button>
        </div>
      </form>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-soft)" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Live preview</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Sample matches from recently ingested articles, updated as you type.</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          <PreviewPanel state={preview} />
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({ state }: { state: PreviewState }) {
  if (state.status === "idle") {
    return <EmptyState text="Start typing a query to see sample matches from recent articles here." />;
  }
  if (state.status === "loading") {
    return <EmptyState text="Checking recent articles…" />;
  }
  if (state.status === "error") {
    return (
      <div style={{ fontSize: 13, color: "var(--critical)", background: "color-mix(in srgb, var(--critical) 8%, transparent)", padding: "10px 12px", borderRadius: 8 }}>
        {state.message}
      </div>
    );
  }

  if (state.matches.length === 0) {
    return (
      <EmptyState
        text={`No matches in the last ${state.lookbackHours}h, out of ${state.scanned.toLocaleString()} recent articles scanned. This could mean the query is too narrow, or there just hasn't been relevant coverage recently.`}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {state.matches.length}{state.truncated ? "+" : ""} match{state.matches.length === 1 ? "" : "es"} out of {state.scanned.toLocaleString()} articles
        scanned (last {state.lookbackHours}h)
      </div>
      {state.matches.map((m) => (
        <a
          key={m.id}
          href={m.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="panel"
          style={{ display: "block", padding: "12px 14px", textDecoration: "none", color: "inherit" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {m.source_type}
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)", flexShrink: 0 }}>
              {timeAgo(m.published_at)}
            </span>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.4, fontWeight: 600, marginBottom: 2 }}>{m.title ?? m.content.slice(0, 120)}</div>
          {m.geo_label && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{m.geo_label}</div>}
        </a>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "12px 4px", lineHeight: 1.5 }}>{text}</div>;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};

const backBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "5px 10px",
  background: "var(--panel-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13.5,
};
