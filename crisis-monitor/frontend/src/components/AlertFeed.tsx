import type { AlertItem } from "../api";

const LEVEL_STYLES: Record<string, { color: string; label: string }> = {
  critical: { color: "var(--critical)", label: "CRITICAL" },
  elevated: { color: "var(--elevated)", label: "ELEVATED" },
  info: { color: "var(--info)", label: "INFO" },
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

interface Props {
  alerts: AlertItem[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}

export default function AlertFeed({ alerts, onAcknowledge, onResolve }: Props) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border-soft)" }}>
        <div className="eyebrow">ALERT FEED</div>
      </div>
      <div style={{ overflowY: "auto", flex: 1, padding: "8px 12px" }}>
        {alerts.length === 0 && (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "20px 8px" }}>
            No open alerts. Escalations will appear here as they're detected.
          </div>
        )}
        {alerts.map((a) => {
          const style = LEVEL_STYLES[a.level];
          return (
            <div
              key={a.id}
              style={{
                borderLeft: `3px solid ${style.color}`,
                background: "var(--panel-raised)",
                borderRadius: "0 6px 6px 0",
                padding: "10px 12px",
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span
                  className="mono"
                  style={{ color: style.color, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em" }}
                >
                  {style.label}
                </span>
                <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>
                  {timeAgo(a.created_at)}
                </span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, margin: "4px 0 2px" }}>{a.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.4 }}>{a.description}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {!a.acknowledged_at && (
                  <button
                    onClick={() => onAcknowledge(a.id)}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      color: "var(--text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    Acknowledge
                  </button>
                )}
                <button
                  onClick={() => onResolve(a.id)}
                  style={{
                    fontSize: 11,
                    padding: "4px 10px",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    color: "var(--positive)",
                    cursor: "pointer",
                  }}
                >
                  Resolve
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
