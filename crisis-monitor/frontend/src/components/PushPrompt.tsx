import { useEffect, useState } from "react";
import { enablePushAlerts, pushSupported, thisDeviceEndpoint } from "../pushAlerts";

const DISMISSED = "lens.pushPrompt.dismissed";
const IOS_DISMISSED = "lens.iosInstall.dismissed";
const seen = (key = DISMISSED) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };

/** iPhone and iPad only allow alerts for The Lens once it is added to the Home Screen and opened from there. */
const isIOS = () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

/** Once per device after signing in: offers device notifications for escalation alerts. A device that has already
 *  allowed them is registered again quietly, so a person who signs in on a new browser they have allowed gets them. */
export default function PushPrompt() {
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) {
      if (isIOS() && !isStandalone() && !seen(IOS_DISMISSED)) setIosHint(true);
      return;
    }
    if (Notification.permission === "granted") {
      void thisDeviceEndpoint().then((ep) => { if (!ep) void enablePushAlerts({ askPermission: false }); });
      return;
    }
    if (Notification.permission === "default" && !seen()) setShow(true);
  }, []);

  const cardStyle = { position: "fixed" as const, left: 12, right: 12, bottom: 12, zIndex: 3000, maxWidth: 340, marginLeft: "auto", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.28)", padding: "14px 16px", display: "flex", flexDirection: "column" as const, gap: 8 };

  if (iosHint) {
    const closeIos = () => { try { localStorage.setItem(IOS_DISMISSED, "1"); } catch { /* private mode */ } setIosHint(false); };
    return (
      <div role="dialog" aria-label="Add The Lens to your Home Screen" style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Get escalation alerts on your iPhone</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
          Tap the Share button in Safari, choose “Add to Home Screen”, then open The Lens from its new icon and turn alerts on there.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, fontSize: 13, cursor: "pointer" }} onClick={closeIos}>
            Got it
          </button>
        </div>
      </div>
    );
  }

  if (!show) return null;
  const close = () => { try { localStorage.setItem(DISMISSED, "1"); } catch { /* private mode */ } setShow(false); };
  return (
    <div role="dialog" aria-label="Escalation alerts on this device" style={cardStyle}>
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
