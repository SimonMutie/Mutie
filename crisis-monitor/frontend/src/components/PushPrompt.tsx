import { useEffect, useState } from "react";
import { enablePushAlerts, pushSupported, thisDeviceEndpoint } from "../pushAlerts";

const DISMISSED = "lens.pushPrompt.dismissed";
const seen = () => { try { return localStorage.getItem(DISMISSED) === "1"; } catch { return false; } };

/** Once per device after signing in: offers device notifications for escalation alerts. A device that has already
 *  allowed them is registered again quietly, so a person who signs in on a new browser they have allowed gets them. */
export default function PushPrompt() {
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) return;
    if (Notification.permission === "granted") {
      void thisDeviceEndpoint().then((ep) => { if (!ep) void enablePushAlerts({ askPermission: false }); });
      return;
    }
    if (Notification.permission === "default" && !seen()) setShow(true);
  }, []);

  if (!show) return null;
  const close = () => { try { localStorage.setItem(DISMISSED, "1"); } catch { /* private mode */ } setShow(false); };
  return (
    <div role="dialog" aria-label="Escalation alerts on this device" style={{ position: "fixed", right: 16, bottom: 16, zIndex: 3000, maxWidth: 340, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.28)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>Get escalation alerts on this device?</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>They pop up as a notification even when The Lens is closed or the device was asleep.</div>
      {msg && <div style={{ fontSize: 12, color: "var(--critical)" }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={{ padding: "6px 14px", background: "var(--signal-dim)", border: "1px solid var(--signal)", color: "var(--text-primary)", borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer" }} onClick={async () => { const err = await enablePushAlerts({ askPermission: true }); if (err) setMsg(err); else close(); }}>
          Turn on
        </button>
        <button type="button" style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, fontSize: 13, cursor: "pointer" }} onClick={close}>
          Not now
        </button>
      </div>
    </div>
  );
}
