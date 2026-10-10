import { useEffect, useState } from "react";
import { api, setToken, type AuthUser, type EscalationPipelineStatus } from "../api";
import AlertDeliveryPanel from "./AlertDeliveryPanel";
import { REPLAY_EVENT, introSoundEnabled, setIntroSoundEnabled } from "../intro";

interface Props {
  onBack: () => void;
  user: AuthUser;
}

/** Available to every authenticated user — platform admin or any client
 *  login, including a client's own teammates — not gated by role, unlike
 *  most of this app's other admin-facing panels. Currently just password
 *  change, but the container is deliberately named and structured to hold
 *  more personal-account settings later without needing a rework. */
export default function SettingsPanel({ onBack, user }: Props) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <button onClick={onBack} style={backBtnStyle}>
        ← Back
      </button>

      <div className="eyebrow" style={{ margin: "16px 0 14px" }}>
        SETTINGS
      </div>

      <ChangePasswordForm />

      <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Conflict escalation alerts</div>
        <AlertDeliveryPanel target={{ scope: "escalations" }} />
      </div>

      {user.role === "admin" && (
        <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Test the alert pop-up and sound</div>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginBottom: 10 }}>Sends a made-up alert to this browser only. Nothing is saved.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => api.sendTestAlert("elevated").catch(() => {})}>Send Elevated test</button>
            <button onClick={() => api.sendTestAlert("critical").catch(() => {})}>Send Critical test</button>
          </div>
        </div>
      )}

      <SignOutEverywhereCard />

      <CreditsCard />

      <OpeningSequenceCard />

      {user.role === "admin" && <AiUsageCard />}
    </div>
  );
}

/** Ends every session this login has, on every device. */
function SignOutEverywhereCard() {
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!window.confirm("Sign out on every device, including this one?")) return;
    setBusy(true);
    try {
      await api.logoutAll();
    } catch {
      /* the session may already be gone */
    }
    setToken(null);
    window.location.reload();
  }
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sign out everywhere</div>
      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)", margin: "8px 0 12px" }}>
        Use this after losing a device or signing in on a shared computer. Every session ends and you sign in again with your password.
      </p>
      <button onClick={go} disabled={busy} style={backBtnStyle}>
        {busy ? "Signing out…" : "Sign out on all devices"}
      </button>
    </div>
  );
}

/** Where the platform's data comes from, with the credits those sources ask for. */
function CreditsCard() {
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Data sources and use</div>
      <ul style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--text-muted)", margin: "8px 0 10px", paddingLeft: 18 }}>
        <li>Base maps © OpenStreetMap contributors; satellite imagery © Esri and its providers.</li>
        <li>Province boundaries: Natural Earth (public domain) and geoBoundaries (CC BY 4.0).</li>
        <li>Economic indicators: World Bank Open Data (CC BY 4.0).</li>
        <li>Event data: GDELT Project. News headlines link to their original publishers.</li>
        <li>Currency rates: European Central Bank via Frankfurter. Crypto prices: CoinGecko. Energy and interest rates: US Federal Reserve (FRED).</li>
        <li>Escalation assessments are produced with AI assistance from public reporting and can be wrong; check the linked sources before acting on them.</li>
      </ul>
      <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
        Afrilens Consulting analysis for the named client's internal use. Not to be resold or redistributed. Exports carry this notice.
      </div>
    </div>
  );
}

/** The opening sequence's sound, per browser, and a way to see it again. */
function OpeningSequenceCard() {
  const [sound, setSound] = useState(introSoundEnabled);
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 380 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Opening sequence</div>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)", margin: "8px 0 12px" }}>Plays once each time the site is opened. Click anywhere or press a key to skip it.</p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked);
            setIntroSoundEnabled(e.target.checked);
          }}
        />
        Play the opening tone on this browser
      </label>
      <button type="button" onClick={() => window.dispatchEvent(new Event(REPLAY_EVENT))} style={{ ...backBtnStyle, marginTop: 12 }}>
        Play it now
      </button>
    </div>
  );
}

/** Platform admin only: what the platform's AI use is today, what could
 *  cost money, and whether the article reading behind escalation alerts is
 *  actually running — so none of that needs the Cloudflare dashboard. */
function AiUsageCard() {
  const [status, setStatus] = useState<EscalationPipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getEscalationStatus()
        .then((s) => !cancelled && (setStatus(s), setError(null)))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the status."));
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const row = (label: string, value: React.ReactNode, tone?: "ok" | "warn") => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "7px 0", borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ textAlign: "right", fontWeight: 600, color: tone === "ok" ? "var(--positive)" : tone === "warn" ? "var(--elevated)" : "var(--text-primary)" }}>{value}</span>
    </div>
  );

  const ai = status?.ai;
  const count = (name: string) => status?.last24h.find((s) => s.status === name)?.count ?? 0;
  const lastRun = status?.lastRun as { at?: string; aiBudgetReached?: boolean; lastModelError?: { message?: string; provider?: string } | null; } | null | undefined;
  const free = !!ai && ai.budget <= ai.freeAllowance && !status?.paidModelKeySet;
  const lastRunAge = lastRun?.at ? Math.round((Date.now() - Date.parse(lastRun.at)) / 60_000) : null;

  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>AI use and costs</div>
      {error && <div style={{ fontSize: 12.5, color: "var(--critical)", marginTop: 8 }}>{error}</div>}
      {!status && !error && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>Loading…</div>}
      {status && (
        <>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)", margin: "8px 0 12px" }}>
            {free
              ? "The platform's AI use is held inside Cloudflare's free daily allowance. When today's limit is reached it stops calling the AI until the allowance resets, so it cannot produce an AI charge."
              : "The settings below allow AI use that is billed. See the lines marked in amber."}
          </p>
          {ai &&
            row(
              "AI used today",
              `${ai.used.toLocaleString()} of ${ai.budget.toLocaleString()} (free allowance ${ai.freeAllowance.toLocaleString()})`,
              ai.budget <= ai.freeAllowance ? "ok" : "warn"
            )}
          {ai && row("Resets", "03:00 Nairobi time (00:00 UTC)")}
          {row("Paid AI key", status.paidModelKeySet ? "Set: article reading is billed by Anthropic" : "Not set", status.paidModelKeySet ? "warn" : "ok")}
          {row("Translation", status.translationEnabled ? "On (counted within the daily limit)" : "Off", "ok")}
          <div style={{ fontSize: 13.5, fontWeight: 600, margin: "18px 0 6px" }}>Article reading for escalation alerts</div>
          {row("Last run", lastRunAge === null ? "Never" : lastRunAge <= 1 ? "Just now" : `${lastRunAge} minutes ago`, lastRunAge !== null && lastRunAge <= 15 ? "ok" : "warn")}
          {status.headlineTierEnabled !== false && row("Picked up from headlines, last 24 hours", `${status.headline24h ?? 0} reports (no AI used)`)}
          {row("Read in full, last 24 hours", `${count("coded") + count("rejected")} articles (${count("coded")} with reportable events)`)}
          {row("Could not be opened", String(count("unreadable")))}
          {row("Failed", String(count("error")), count("error") > 0 ? "warn" : undefined)}
          {lastRun?.aiBudgetReached && row("Today", "Daily AI limit reached. Reading resumes after the reset.", "warn")}
          {lastRun?.lastModelError?.message && row("Last AI error", `${lastRun.lastModelError.provider ?? "model"}: ${lastRun.lastModelError.message}`, "warn")}
        </>
      )}
    </div>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 12) {
      setError("New password needs to be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password needs to be different from your current one.");
      return;
    }

    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      reset();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change your password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 380 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Change password</div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        Current password
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            setSuccess(false);
          }}
          autoComplete="current-password"
          style={inputStyle}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        New password
        <input
          type="password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setSuccess(false);
          }}
          autoComplete="new-password"
          style={inputStyle}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        Confirm new password
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setSuccess(false);
          }}
          autoComplete="new-password"
          style={inputStyle}
        />
      </label>

      {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
      {success && <div style={{ color: "var(--signal)", fontSize: 12 }}>Password changed.</div>}

      <button type="submit" disabled={submitting || !currentPassword || !newPassword || !confirmPassword} style={{ ...primaryBtnStyle, marginTop: 4 }}>
        {submitting ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};

const backBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 10px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};
