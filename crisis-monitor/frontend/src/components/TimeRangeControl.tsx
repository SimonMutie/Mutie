import { useState } from "react";

export interface TimeRange {
  from: string;
  to: string;
}

interface Props {
  value: TimeRange | null; // null = live
  onChange: (range: TimeRange | null) => void;
}

export default function TimeRangeControl({ value, onChange }: Props) {
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  function presetRange(hoursAgo: number) {
    const to = new Date();
    const from = new Date(to.getTime() - hoursAgo * 60 * 60_000);
    onChange({ from: from.toISOString(), to: to.toISOString() });
    setShowCustom(false);
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    onChange({ from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() });
  }

  const isLive = value === null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={() => {
          onChange(null);
          setShowCustom(false);
        }}
        style={pillStyle(isLive)}
      >
        Live
      </button>
      <button onClick={() => presetRange(24)} style={pillStyle(false)}>
        Last 24h
      </button>
      <button onClick={() => presetRange(24 * 7)} style={pillStyle(false)}>
        Last 7d
      </button>
      <button onClick={() => setShowCustom((s) => !s)} style={pillStyle(showCustom)}>
        Custom…
      </button>

      {showCustom && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          <input
            type="datetime-local"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            style={inputStyle}
          />
          <span style={{ color: "var(--text-faint)", fontSize: 11 }}>to</span>
          <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle} />
          <button onClick={applyCustom} style={applyBtnStyle}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11.5,
    padding: "5px 10px",
    background: active ? "var(--signal-dim)" : "transparent",
    border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
    borderRadius: 6,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "4px 8px",
  fontSize: 11.5,
  fontFamily: "var(--font-body)",
};

const applyBtnStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: "5px 10px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  borderRadius: 6,
  color: "var(--text-primary)",
  cursor: "pointer",
  fontWeight: 600,
};
