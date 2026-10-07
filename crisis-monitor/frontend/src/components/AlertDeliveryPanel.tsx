import { useCallback, useEffect, useState } from "react";
import { api, type AlertChannel, type AlertSubscription, type AlertSubscriptionList } from "../api";

/**
 * Where to be told about new developments: email and/or Signal, for one
 * monitoring query or for the general Conflict Escalation feed. Each message
 * says what changed, gives an interpretive reading, and links the reports.
 * Used on a query's dashboard and in Settings (escalation feed).
 */

type Target = { scope: "escalations" } | { scope: "query"; queryId: string };

const FREQUENCY_LABELS: Record<number, string> = { 15: "Within 15 minutes", 60: "At most hourly", 360: "At most every 6 hours", 1440: "Once a day" };
const CHANNEL_LABEL: Record<AlertChannel, string> = { email: "Email", signal: "Signal" };

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function AlertDeliveryPanel({ target, compact = false }: { target: Target; compact?: boolean }) {
  const [data, setData] = useState<AlertSubscriptionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [channel, setChannel] = useState<AlertChannel>("email");
  const [destination, setDestination] = useState("");
  const isEsc = target.scope === "escalations";
  const [minLevel, setMinLevel] = useState<string>(isEsc ? "elevated" : "any");
  const [frequency, setFrequency] = useState<number>(isEsc ? 15 : 60);

  const queryId = target.scope === "query" ? target.queryId : null;
  const load = useCallback(() => {
    api
      .listAlertSubscriptions(queryId ? { scope: "query", queryId } : { scope: "escalations" })
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError(errText(e, "Could not load your alerts.")));
  }, [queryId]);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      await api.createAlertSubscription({ scope: target.scope, query_id: queryId ?? undefined, channel, destination, min_level: minLevel, frequency_minutes: frequency });
      setDestination("");
      setNotice(isEsc ? "Added. You will hear about escalations that happen from now on." : "Added. You will hear about developments from now on.");
      load();
    } catch (err) {
      setError(errText(err, "Could not add this."));
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, what: "test" | "delete" | "toggle", sub?: AlertSubscription) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      if (what === "test") {
        const r = await api.testAlertSubscription(id);
        setNotice(r.note ?? "Test message sent.");
      } else if (what === "delete") await api.deleteAlertSubscription(id);
      else if (sub) await api.updateAlertSubscription(id, { enabled: !sub.enabled });
      load();
    } catch (err) {
      setError(errText(err, "That did not work."));
      load();
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, p: { min_level?: string; frequency_minutes?: number }) {
    setError(null);
    try {
      await api.updateAlertSubscription(id, p);
      load();
    } catch (err) {
      setError(errText(err, "Could not save that change."));
    }
  }

  const unavailable = (c: AlertChannel) => data && !data.channels[c];
  const levelOptions = isEsc
    ? [
        ["elevated", "Elevated and Critical"],
        ["critical", "Critical only"],
      ]
    : [
        ["any", "Any new development"],
        ["alert", "Only when a coverage-surge alert opens"],
      ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)" }}>
        {isEsc
          ? "Get a message when a conflict escalation is flagged, raised to a higher level, or gains significant new reporting. Each message says what changed, gives an analysis, and links the reports."
          : "Get a message when this query has new developments: a short summary of what changed, an analysis, and links to the reports."}
      </p>

      {data && (unavailable("email") || unavailable("signal")) && (
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--elevated)" }}>
          {unavailable("email") && unavailable("signal") ? "Email and Signal delivery are not set up on this platform yet." : unavailable("email") ? "Email delivery is not set up on this platform yet." : "Signal delivery is not set up on this platform yet."} Alerts you add will wait until the platform administrator finishes the setup.
        </div>
      )}

      {data?.subscriptions.map((s) => (
        <div key={s.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: "10px 12px", background: "var(--panel-raised)", opacity: s.enabled ? 1 : 0.65 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>{CHANNEL_LABEL[s.channel]}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 120, overflowWrap: "anywhere" }}>{s.destination}</span>
            <button type="button" style={miniBtn} disabled={busy === s.id} onClick={() => act(s.id, "test")}>
              Send a test
            </button>
            <button type="button" style={miniBtn} disabled={busy === s.id} onClick={() => act(s.id, "toggle", s)}>
              {s.enabled ? "Pause" : "Resume"}
            </button>
            <button type="button" style={{ ...miniBtn, color: "var(--critical)" }} disabled={busy === s.id} onClick={() => act(s.id, "delete")}>
              Remove
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <select value={s.min_level} onChange={(e) => patch(s.id, { min_level: e.target.value })} style={{ ...field, flex: "1 1 200px" }} aria-label="When to send">
              {levelOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select value={s.frequency_minutes} onChange={(e) => patch(s.id, { frequency_minutes: Number(e.target.value) })} style={{ ...field, flex: "1 1 160px" }} aria-label="How often">
              {Object.entries(FREQUENCY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 11.5, marginTop: 6, color: s.last_status === "error" ? "var(--critical)" : "var(--text-faint)" }}>
            {s.last_status === "error" && s.last_error ? `Last attempt failed: ${s.last_error}` : s.last_sent_at ? `Last sent ${new Date(s.last_sent_at).toLocaleString()}` : "Nothing sent yet"}
            {isEsc && s.min_level === "critical" ? "" : isEsc ? " · Critical escalations are sent at once, whatever the interval." : ""}
          </div>
        </div>
      ))}

      <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Add a destination</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as AlertChannel);
              setDestination("");
            }}
            style={{ ...field, flex: "0 0 110px" }}
            aria-label="Delivery method"
          >
            <option value="email">Email</option>
            <option value="signal">Signal</option>
          </select>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={channel === "email" ? "you@example.com" : "+254712345678"}
            type={channel === "email" ? "email" : "tel"}
            required
            style={{ ...field, flex: "1 1 200px" }}
            aria-label={channel === "email" ? "Email address" : "Signal number"}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={minLevel} onChange={(e) => setMinLevel(e.target.value)} style={{ ...field, flex: "1 1 200px" }} aria-label="When to send">
            {levelOptions.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select value={frequency} onChange={(e) => setFrequency(Number(e.target.value))} style={{ ...field, flex: "1 1 160px" }} aria-label="How often">
            {Object.entries(FREQUENCY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy === "add" || !destination.trim()} style={primaryBtn}>
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </div>
        {channel === "signal" && !compact && <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Write the number with its country code. Signal messages come from the platform's own Signal number, so save it as a contact to see them clearly.</div>}
      </form>

      {error && <div style={{ fontSize: 12.5, color: "var(--critical)" }}>{error}</div>}
      {notice && <div style={{ fontSize: 12.5, color: "var(--positive)" }}>{notice}</div>}
    </div>
  );
}

const field: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "7px 9px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
  minWidth: 0,
};

const miniBtn: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 9px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "7px 16px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
