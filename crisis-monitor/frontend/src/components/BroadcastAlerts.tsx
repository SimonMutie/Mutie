import { useEffect, useMemo, useState } from "react";
import { api, type BroadcastPreview, type BroadcastRow, type ClientOrg, type ContactGroup } from "../api";
import ContactGroups from "./ContactGroups";

const btn: React.CSSProperties = { fontSize: 12.5, padding: "6px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "var(--signal-dim)", border: "1px solid var(--signal)", color: "var(--text-primary)", fontWeight: 600 };
const danger: React.CSSProperties = { ...btn, border: "1px solid var(--critical)", color: "var(--critical)", fontWeight: 600 };
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "7px 9px", background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "inherit" };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: "0.06em", color: "var(--text-faint)", fontWeight: 600, margin: "12px 0 5px" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, letterSpacing: "0.06em", color: "var(--text-faint)", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "7px 8px", fontSize: 12.5, borderBottom: "1px solid var(--border-soft)", verticalAlign: "top" };

const SEVERITY_NOTE = { info: "Routine information", advisory: "Advisory: flagged in the subject", urgent: "Urgent: flagged in the subject" } as const;
type Channel = "email" | "sms" | "signal" | "push";

/** Super-admin page: write one alert and send it to many people at once. */
export default function BroadcastAlerts({ onBack }: { onBack: () => void }) {
  const [clients, setClients] = useState<ClientOrg[]>([]);
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [mode, setMode] = useState<"all_clients" | "clients" | "list_only">("all_clients");
  const [picked, setPicked] = useState<string[]>([]);
  const [channels, setChannels] = useState<Channel[]>(["email"]);
  const [extras, setExtras] = useState("");
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [pickedGroups, setPickedGroups] = useState<string[]>([]);
  const [tab, setTab] = useState<"send" | "contacts">("send");
  const [severity, setSeverity] = useState<"info" | "advisory" | "urgent">("advisory");
  const [country, setCountry] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; failures: { channel: string; destination: string; error: string }[] } | null>(null);
  const [stop, setStop] = useState<{ destination: string; note: string | null }[]>([]);
  const [newStop, setNewStop] = useState("");

  const reloadGroups = () => api.listContactGroups().then(setGroups).catch(() => {});

  async function loadHistory() {
    const r = await api.listBroadcasts().catch(() => null);
    if (r) {
      setHistory(r.broadcasts);
      setAvailable(r.channels);
    }
  }
  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
    loadHistory();
    api.listSuppressions().then(setStop).catch(() => {});
    reloadGroups();
  }, [tab]);

  // Any change to the audience or channels invalidates the preview, so a send always matches what was confirmed.
  const audience = useMemo(() => ({ mode, client_ids: mode === "clients" ? picked : [], group_ids: pickedGroups, channels, extras }), [mode, picked, pickedGroups, channels, extras]);
  useEffect(() => setPreview(null), [audience]);

  const msg = { subject: subject.trim(), message: message.trim(), severity, country: country.trim() || null, link: link.trim() || null };
  const messageOk = msg.subject.length >= 3 && msg.message.length >= 5;
  const smsLength = msg.subject.length + msg.message.replace(/\s*\n+\s*/g, " ").length + (msg.link ? msg.link.length + 1 : 0) + 24;
  // Plain text fits 160 characters in one part, then 153 per part; messages with non-GSM characters fit 70 and 67.
  const smsPerPart = /[^\x20-\x7e\n]/.test(msg.subject + msg.message) ? [70, 67] : [160, 153];
  const smsParts = Math.min(3, smsLength <= smsPerPart[0] ? 1 : Math.ceil(smsLength / smsPerPart[1]));
  const toggleChannel = (c: Channel) => setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  async function doPreview() {
    setError(null);
    setNote(null);
    setBusy("Working out who would receive this…");
    try {
      setPreview(await api.previewBroadcast(audience));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't preview the audience.");
    }
    setBusy(null);
  }

  async function doTest() {
    setError(null);
    setNote(null);
    setBusy("Sending the test…");
    try {
      await api.testBroadcast({ ...msg, channel: testTo.includes("@") ? "email" : channels.includes("sms") || !channels.includes("signal") ? "sms" : "signal", destination: testTo.trim() });
      setNote(`A test was sent to ${testTo.trim()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The test could not be sent.");
    }
    setBusy(null);
  }

  async function doSend() {
    if (!preview || !messageOk) return;
    const ok = window.confirm(`Send "${msg.subject}" to ${preview.total} recipient${preview.total === 1 ? "" : "s"}?\n\nA sent alert cannot be recalled.`);
    if (!ok) return;
    setError(null);
    setNote(null);
    let id = "";
    try {
      setBusy("Starting…");
      const created = await api.createBroadcast({ ...msg, ...audience, confirm_total: preview.total });
      id = created.id;
      let sent = 0;
      let failed = 0;
      for (let guard = 0; guard < 120; guard++) {
        const r = await api.sendBroadcastBatch(id);
        sent += r.sent;
        failed += r.failed;
        setBusy(`Sending… ${sent + failed} of ${created.total} (${failed} failed)`);
        if (r.remaining === 0 || r.status === "cancelled") break;
      }
      setNote(`Done: ${sent} sent${failed ? `, ${failed} failed (see the history below)` : ""}.`);
      setPreview(null);
      setSubject("");
      setMessage("");
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Sending stopped."}${id ? " You can resume it from the history below." : ""}`);
    }
    setBusy(null);
    loadHistory();
  }

  async function resume(id: string) {
    setError(null);
    setBusy("Resuming…");
    try {
      for (let guard = 0; guard < 120; guard++) {
        const r = await api.sendBroadcastBatch(id);
        if (r.remaining === 0 || r.status === "cancelled") break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resume.");
    }
    setBusy(null);
    loadHistory();
  }

  async function show(id: string) {
    const r = await api.getBroadcast(id).catch(() => null);
    if (r) setDetail({ id, failures: r.failures });
  }

  async function addStop() {
    if (!newStop.trim()) return;
    await api.addSuppression(newStop.trim()).catch((e) => setError(e instanceof Error ? e.message : "Couldn't add."));
    setNewStop("");
    setStop(await api.listSuppressions().catch(() => stop));
    setPreview(null);
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24, maxWidth: 980 }}>
      <button onClick={onBack} style={btn}>
        ← Back
      </button>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 14 }}>Broadcast alerts</div>
      <div style={{ display: "flex", gap: 8, margin: "12px 0 0" }}>
        <button onClick={() => setTab("send")} style={tab === "send" ? primary : btn}>
          Send an alert
        </button>
        <button onClick={() => setTab("contacts")} style={tab === "contacts" ? primary : btn}>
          Contact groups
        </button>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 16px", maxWidth: 740, lineHeight: 1.6 }}>
        Write one alert and send it to many people at once: every client organisation, chosen ones, and/or a pasted list of extra contacts. Client members are reached at the destinations they registered themselves, within each organisation's approved alert domains and numbers. You see exactly who will receive it before anything is sent.
      </div>

      {tab === "contacts" && <ContactGroups onChanged={reloadGroups} />}
      {tab === "send" && (
        <>
      {error && <div style={{ color: "var(--critical)", fontSize: 13, margin: "8px 0" }}>{error}</div>}
      {note && <div style={{ color: "var(--signal)", fontSize: 13, margin: "8px 0" }}>{note}</div>}

      <div className="panel" style={{ padding: "4px 16px 16px" }}>
        <div style={label}>1. MESSAGE</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} style={{ ...field, width: 240 }} title={SEVERITY_NOTE[severity]}>
            <option value="info">Information</option>
            <option value="advisory">Advisory</option>
            <option value="urgent">Urgent</option>
          </select>
          <input placeholder="Country code (optional), e.g. ET" value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...field, width: 240 }} />
        </div>
        <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} style={{ ...field, marginTop: 8 }} />
        <textarea placeholder="What recipients need to know. Plain text; blank lines make paragraphs." value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={7} style={{ ...field, marginTop: 8, resize: "vertical" }} />
        <input placeholder="Link (optional), e.g. a dashboard or report" value={link} onChange={(e) => setLink(e.target.value)} style={{ ...field, marginTop: 8 }} />

        <div style={label}>2. WHO RECEIVES IT</div>
        {(
          [
            ["all_clients", "Every client organisation"],
            ["clients", "Selected organisations"],
            ["list_only", "Only the contact groups and contacts I choose below"],
          ] as const
        ).map(([v, t]) => (
          <label key={v} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "4px 0" }}>
            <input type="radio" checked={mode === v} onChange={() => setMode(v)} /> {t}
          </label>
        ))}
        {mode === "clients" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", margin: "6px 0 2px 24px" }}>
            {clients.map((c) => (
              <label key={c.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={picked.includes(c.id)} onChange={() => setPicked((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))} /> {c.name}
              </label>
            ))}
          </div>
        )}
        <div style={{ ...label, marginTop: 10 }}>CONTACT GROUPS</div>
        {groups.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            No groups yet. <button onClick={() => setTab("contacts")} style={{ ...btn, padding: "2px 8px" }}>Create a contact group</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            {groups.map((g) => (
              <label key={g.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={pickedGroups.includes(g.id)} onChange={() => setPickedGroups((cur) => (cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id]))} /> {g.name} <span style={{ color: "var(--text-faint)" }}>({g.members})</span>
              </label>
            ))}
          </div>
        )}
        <textarea placeholder="Extra contacts (optional): email addresses and Signal numbers like +254712345678, separated by commas, spaces or new lines" value={extras} onChange={(e) => setExtras(e.target.value)} rows={3} style={{ ...field, marginTop: 8, resize: "vertical" }} />

        <div style={label}>3. CHANNELS</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {(
            [
              ["email", "Email"],
              ["sms", "SMS (groups and pasted numbers)"],
              ["signal", "Signal"],
              ["push", "Device notifications (members only)"],
            ] as const
          ).map(([c, t]) => (
            <label key={c} style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", opacity: available[c] === false ? 0.5 : 1 }} title={available[c] === false ? "Not set up on this platform yet" : ""}>
              <input type="checkbox" checked={channels.includes(c)} onChange={() => toggleChannel(c)} /> {t}
              {available[c] === false && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>(not set up)</span>}
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
          <button onClick={doPreview} disabled={busy !== null || channels.length === 0} style={btn}>
            Preview audience
          </button>
          <input placeholder="Test to (email or +number)" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ ...field, width: 230 }} />
          <button onClick={doTest} disabled={busy !== null || !messageOk || testTo.trim().length < 5} style={btn}>
            Send me a test
          </button>
          <button onClick={doSend} disabled={busy !== null || !preview || preview.total === 0 || preview.over_limit || !messageOk} style={preview && messageOk && preview.total > 0 && !preview.over_limit ? danger : btn}>
            {preview ? `Send to ${preview.total}` : "Send"}
          </button>
          {busy && <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{busy}</span>}
        </div>

        {channels.includes("sms") && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
            SMS is billed per message part by the provider. This one is about {smsParts} part{smsParts === 1 ? "" : "s"} per recipient. SMS keeps to the subject, the first lines of the message and the link.
          </div>
        )}
        {preview && (
          <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6 }}>
            <strong>{preview.total}</strong> recipient{preview.total === 1 ? "" : "s"}: {preview.counts.email ?? 0} email, {preview.counts.sms ?? 0} SMS, {preview.counts.signal ?? 0} Signal, {preview.counts.push ?? 0} device
            {preview.over_limit && <span style={{ color: "var(--critical)" }}> · over the limit of {preview.limit} per send; split it into smaller groups</span>}
            {preview.skipped_total > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>{preview.skipped_total} left out</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--text-muted)", fontSize: 12.5 }}>
                  {preview.skipped.map((s, i) => (
                    <li key={i}>
                      {s.destination}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <div style={{ ...label, marginTop: 24 }}>HISTORY</div>
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>WHEN</th>
              <th style={th}>SUBJECT</th>
              <th style={th}>LEVEL</th>
              <th style={th}>SENT</th>
              <th style={th}>FAILED</th>
              <th style={th}>STATUS</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--text-muted)" }} colSpan={7}>
                  Nothing has been broadcast yet.
                </td>
              </tr>
            )}
            {history.map((h) => (
              <tr key={h.id}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{new Date(h.created_at).toLocaleString()}</td>
                <td style={td}>{h.subject}</td>
                <td style={td}>{h.severity}</td>
                <td style={td}>
                  {h.sent} / {h.total}
                </td>
                <td style={{ ...td, color: h.failed ? "var(--critical)" : undefined }}>{h.failed}</td>
                <td style={td}>{h.status}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {h.failed > 0 && (
                    <button onClick={() => show(h.id)} style={btn}>
                      Failures
                    </button>
                  )}{" "}
                  {h.status === "sending" && (
                    <>
                      <button onClick={() => resume(h.id)} disabled={busy !== null} style={primary}>
                        Resume
                      </button>{" "}
                      <button onClick={() => api.cancelBroadcast(h.id).then(loadHistory)} style={btn}>
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && (
        <div className="panel" style={{ padding: 14, marginTop: 10 }}>
          <div className="eyebrow">DELIVERY FAILURES</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--text-muted)" }}>
            {detail.failures.map((f, i) => (
              <li key={i}>
                {f.channel === "push" ? "a device" : f.destination}: {f.error}
              </li>
            ))}
          </ul>
          <button onClick={() => setDetail(null)} style={{ ...btn, marginTop: 8 }}>
            Close
          </button>
        </div>
      )}

      <div style={{ ...label, marginTop: 24 }}>DO-NOT-SEND LIST</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>Anyone listed here is skipped on every broadcast, whoever asked for them to be included. Add people who have asked to stop.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input placeholder="Email or +number" value={newStop} onChange={(e) => setNewStop(e.target.value)} style={{ ...field, width: 260 }} />
        <button onClick={addStop} style={btn}>
          Add
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {stop.map((s) => (
          <span key={s.destination} className="mono" style={{ fontSize: 11.5, border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px" }}>
            {s.destination}{" "}
            <button onClick={() => api.removeSuppression(s.destination).then(() => api.listSuppressions().then(setStop))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)" }} aria-label="Remove">
              ×
            </button>
          </span>
        ))}
      </div>
        </>
      )}
    </div>
  );
}
