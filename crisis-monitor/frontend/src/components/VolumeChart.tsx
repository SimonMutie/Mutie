import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Props {
  data: { minute: string; count: number }[];
}

export default function VolumeChart({ data }: Props) {
  const formatted = data.map((d) => ({
    time: new Date(d.minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    count: d.count,
  }));

  return (
    <div className="panel" style={{ padding: "14px 16px", height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>EVENT VOLUME · LAST 60 MIN</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--signal)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--signal)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: "var(--text-faint)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "var(--text-faint)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={{
                background: "var(--panel-raised)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "var(--font-mono)",
              }}
              labelStyle={{ color: "var(--text-muted)" }}
            />
            <Area type="monotone" dataKey="count" stroke="var(--signal)" strokeWidth={2} fill="url(#volumeFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
