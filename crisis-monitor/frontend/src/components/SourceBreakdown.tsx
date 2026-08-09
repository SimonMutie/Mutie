import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const COLORS: Record<string, string> = {
  social: "#4c8dff",
  news: "#35c97c",
  forum: "#f0a93b",
  darkweb: "#f0473f",
};

interface Props {
  bySource: { source_type: string; count: number }[];
  sentiment: { negative: number; neutral: number; positive: number };
  /** Overrides the "LAST 2H" header — pass a description of the active range when browsing history. */
  label?: string;
}

export default function SourceBreakdown({ bySource, sentiment, label }: Props) {
  const total = sentiment.negative + sentiment.neutral + sentiment.positive || 1;

  return (
    <div className="panel" style={{ padding: "14px 16px", height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="eyebrow">SOURCE MIX · {label ?? "LAST 2H"}</div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, minHeight: 0 }}>
        <div style={{ width: "55%", height: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={bySource}
                dataKey="count"
                nameKey="source_type"
                innerRadius="60%"
                outerRadius="90%"
                paddingAngle={2}
                stroke="var(--panel)"
                strokeWidth={2}
              >
                {bySource.map((s) => (
                  <Cell key={s.source_type} fill={COLORS[s.source_type] ?? "#666"} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--panel-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          {bySource.map((s) => (
            <div key={s.source_type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[s.source_type] }} />
              <span style={{ color: "var(--text-muted)", textTransform: "capitalize", flex: 1 }}>
                {s.source_type}
              </span>
              <span className="mono" style={{ color: "var(--text-primary)" }}>{s.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>SENTIMENT</div>
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${(sentiment.negative / total) * 100}%`, background: "var(--critical)" }} />
          <div style={{ width: `${(sentiment.neutral / total) * 100}%`, background: "var(--text-faint)" }} />
          <div style={{ width: `${(sentiment.positive / total) * 100}%`, background: "var(--positive)" }} />
        </div>
      </div>
    </div>
  );
}
