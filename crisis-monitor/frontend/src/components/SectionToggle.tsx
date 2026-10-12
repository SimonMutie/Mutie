import { useRef, useState, type ReactNode } from "react";
import ElementExportMenu, { type ExportChoice } from "./ElementExportMenu";
import { exportElement, exportElementGif } from "../report/elementExport";
import PublishVisualButton from "./PublishVisual";

/**
 * A section on the Kenya and South Sudan pages can be hidden by its reader.
 * The heading always stays, so the page still reads in order and the reader
 * can open the section again. The choice lasts for the visit only.
 *
 * Every section can also be downloaded as a PDF, Word document, animated
 * PowerPoint or GIF. A hidden section has nothing on screen to draw, so its
 * download is switched off until it is shown.
 */
export function SectionFrame({
  id,
  prefix,
  kicker,
  title,
  intro,
  children,
}: {
  id: string;
  prefix: string;
  kicker: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyId = `${prefix}-${id}-body`;
  const fileBase = `${prefix}-${id}-${new Date().toISOString().slice(0, 10)}`;

  async function download(fmt: ExportChoice) {
    const el = bodyRef.current;
    if (!el || !open) return;
    setError(null);
    setNote(null);
    setBusy(fmt === "gif" ? "Recording…" : "Preparing…");
    try {
      if (fmt === "gif") {
        await exportElementGif(el, fileBase, (p) => setBusy(p.phase === "capturing" ? `Recording ${p.current}/${p.total}…` : `Encoding ${Math.round(p.current * 100)}%…`));
      } else {
        const warning = await exportElement(el, fmt, { fileBase, title, kicker });
        if (warning) setNote(warning);
      }
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 160) : "unknown error";
      console.error(`[section download] ${fmt} failed for ${fileBase}:`, err);
      setError(`That download did not work (${fmt.toUpperCase()}: ${why}). Try again.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`el-section${open ? "" : " is-collapsed"}`} id={`${prefix}-${id}`}>
      <p className="el-kicker">{kicker}</p>
      <h2>{title}</h2>
      <div className="el-sec-tools">
        <button
          type="button"
          className="el-sec-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="el-sec-toggle__chev" aria-hidden="true">▾</span>
          {open ? "Hide section" : "Show section"}
        </button>
        <ElementExportMenu busy={busy} disabled={!open} reason="Show the section to download it" onPick={download} />
        <PublishVisualButton
          target={() => bodyRef.current}
          title={title}
          kicker={kicker}
          disabled={!open}
          reason="Show the section to publish it"
        />
        {note && <span className="el-export__note" role="status">{note}</span>}
        {error && <span className="el-export__error" role="alert">{error}</span>}
      </div>
      <div id={bodyId} ref={bodyRef} className="el-sec-body" hidden={!open}>
        {intro && <div className="el-intro">{intro}</div>}
        {children}
      </div>
    </section>
  );
}
