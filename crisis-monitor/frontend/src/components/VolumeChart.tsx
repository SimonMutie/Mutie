import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Props {
  data: { minute: string; count: number }[];
  /** Overrides the "LAST 60 MIN" header — pass a description of the active range when browsing history. */
  label?: string;
}

/**
 * Bucket strings come from the backend as an ISO-8601 prefix of varying
 * length depending on the requested range: "YYYY-MM-DD" (day), "...THH"
 * (hour), or "...THH:MM" (minute) — none of which `new Date()` parses
 * reliably on their own (a bare "...T12" isn't valid ISO 8601), so pad to a
 * full timestamp first.
 */
function parseBucket(bucket: string): Date {
  let iso = bucket;
  if (iso.length === 10) iso += "T00:00:00Z";
  else if (iso.length === 13) iso += ":00:00Z";
  else if (iso.length === 16) iso += ":00Z";
  else if (!iso.endsWith("Z")) iso += "Z";
  return new Date(iso);
}

function formatBucket(bucket: string): string {
  const date = parseBucket(bucket);
  if (bucket.length === 10) return date.toLocaleDateString([], { month: "short", day: "numeric" });
  if (bucket.length === 13) return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" });
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function VolumeChart({ data, label }: Props) {
  const formatted = data.map((d) => ({
    time: formatBucket(d.minute),
    count: d.count,
  }));

  return (
    <div className="panel" style={{ padding: "14px 16px", height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>EVENT VOLUME · {label ?? "LAST 60 MIN"}</div>
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
