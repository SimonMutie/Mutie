interface Props {
  connected: boolean;
  eventsPerMinute: number;
  openAlertCount: number;
}

export default function TopBar({ connected, eventsPerMinute, openAlertCount }: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 24px",
        borderBottom: "1px solid var(--border-soft)",
        background: "var(--panel)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: connected ? "var(--signal)" : "var(--text-faint)",
            boxShadow: connected ? "0 0 10px var(--signal)" : "none",
            animation: connected ? "pulse 2s ease-in-out infinite" : "none",
          }}
        />
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          SENTINEL
        </h1>
        <span className="eyebrow">CRISIS MONITORING</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">EVENT RATE</div>
          <div className="mono" style={{ fontSize: 15, color: "var(--text-primary)" }}>
            {eventsPerMinute}/min
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">OPEN ALERTS</div>
          <div
            className="mono"
            style={{
              fontSize: 15,
              color: openAlertCount > 0 ? "var(--critical)" : "var(--text-primary)",
              fontWeight: 600,
            }}
          >
            {openAlertCount}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">LINK</div>
          <div className="mono" style={{ fontSize: 15, color: connected ? "var(--signal)" : "var(--critical)" }}>
            {connected ? "LIVE" : "RECONNECTING"}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </header>
  );
}
