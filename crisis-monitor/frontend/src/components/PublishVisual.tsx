import { useState } from "react";
import { visualsApi } from "../api";
import { useSessionUser } from "../session";
import { settleForCapture, revealEverything } from "../lib/motion";
import { captureElementAsGif } from "../gifCapture";
import { buildLiveCopy } from "../lib/liveCopy";

/**
 * Admins can publish one visual (a timeline, chart, infographic or dashboard
 * widget) as its own link, in two forms:
 *  - Live: the visual's layout and CSS motion, playing in the viewer's browser.
 *  - GIF: a short animated recording of the visual.
 * The link shows only that visual, with its title and date, and works for
 * anyone who has it until it is revoked.
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
  const [busy, setBusy] = useState<"live" | "gif" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (user?.role !== "admin") return null;

  async function publish(kind: "live" | "gif") {
    const el = target();
    if (!el) return;
    setBusy(kind);
    setError(null);
    setCopied(false);
    try {
      revealEverything();
      await settleForCapture(el);
      let body: { kind: "html" | "gif"; content: string; width: number; height: number };
      if (kind === "live") {
        const copy = buildLiveCopy(el, "#ffffff");
        body = { kind: "html", content: copy.html, width: copy.width, height: copy.height };
      } else {
        const rect = el.getBoundingClientRect();
        const blob = await captureElementAsGif(
          el,
          (p) => setProgress(p.phase === "capturing" ? `Recording ${p.current}/12…` : `Encoding ${Math.round(p.current * 100)}%…`),
          { frameCount: 12, frameDelayMs: 150, ignore: (n) => n.classList.contains("rpt-noprint") || n.matches("button, .el-sec-toggle, .pv-wrap") },
        );
        body = { kind: "gif", content: await blobToDataUrl(blob), width: Math.round(rect.width), height: Math.round(rect.height) };
      }
      const r = await visualsApi.publish({ title, kicker, ...body });
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
      console.error(`[publish ${kind}] failed:`, err);
      setError(`The link could not be made (${why}). Try again.`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const off = disabled || busy !== null;
  const hint = disabled ? reason : undefined;

  return (
    <span className="pv-wrap">
      <button type="button" className="pv-btn" onClick={() => publish("live")} disabled={off} title={hint ?? "Publish a live copy that plays the visual's motion"}>
        {busy === "live" ? progress ?? "Publishing…" : "Publish live"}
      </button>
      <button type="button" className="pv-btn" onClick={() => publish("gif")} disabled={off} title={hint ?? "Publish an animated GIF of the visual"}>
        {busy === "gif" ? progress ?? "Publishing…" : "Publish GIF"}
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
