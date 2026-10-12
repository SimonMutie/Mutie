import { useState } from "react";
import { visualsApi } from "../api";
import { useSessionUser } from "../session";
import { settleForCapture, revealEverything } from "../lib/motion";
import { snapshot } from "../report/monthlyExport";

/**
 * Admins can publish one visual (a timeline, chart, infographic or dashboard
 * widget) as its own link. The link shows only that picture, with its title
 * and date, and works for anyone who has it until it is revoked.
 */
export default function PublishVisualButton({
  target,
  title,
  kicker,
  disabled,
  reason,
}: {
  target: () => HTMLElement | null;
  title: string;
  kicker: string;
  disabled?: boolean;
  reason?: string;
}) {
  const user = useSessionUser();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (user?.role !== "admin") return null;

  async function publish() {
    const el = target();
    if (!el) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      revealEverything();
      await settleForCapture(el);
      const snap = await snapshot(el, "lens");
      const r = await visualsApi.publish({ title, kicker, png: snap.png });
      const url = `${window.location.origin}${r.path}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        // The link is still shown below, so it can be copied by hand.
      }
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 160) : "unknown error";
      setError(`The link could not be made (${why}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="pv-wrap">
      <button
        type="button"
        className="pv-btn"
        onClick={publish}
        disabled={busy || disabled}
        title={disabled ? reason : "Publish this visual as its own link"}
      >
        {busy ? "Publishing…" : "Publish link"}
      </button>
      {copied && <span className="pv-note" role="status">Link copied</span>}
      {link && (
        <span className="pv-link">
          <input readOnly value={link} aria-label="Visual link" onFocus={(e) => e.currentTarget.select()} />
        </span>
      )}
      {error && <span className="el-export__error" role="alert">{error}</span>}
    </span>
  );
}
