import { useState } from "react";
import { visualsApi } from "../api";
import { useSessionUser } from "../session";
import { settleForCapture, revealEverything } from "../lib/motion";
import { captureElementAsGif } from "../gifCapture";

/**
 * Admins can publish one visual (a timeline, chart, infographic or dashboard
 * widget) as its own link. The link plays the visual's motion as an animation,
 * with its title and date, and works for anyone who has it until it is revoked.
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
  const [progress, setProgress] = useState<string | null>(null);

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
      const blob = await captureElementAsGif(
        el,
        (p) => setProgress(p.phase === "capturing" ? `Recording ${p.current}/${p.total}…` : `Encoding ${Math.round(p.current * 100)}%…`),
        { frameCount: 36, frameDelayMs: 120, ignore: (n) => n.classList.contains("rpt-noprint") || n.matches("button, .el-sec-toggle, .pv-wrap") },
      );
      const image = await blobToDataUrl(blob);
      const r = await visualsApi.publish({ title, kicker, image });
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
      setProgress(null);
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
        {busy ? progress ?? "Publishing…" : "Publish link"}
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("the animation could not be read"));
    reader.readAsDataURL(blob);
  });
}
