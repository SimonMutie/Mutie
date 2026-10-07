import { useEffect, useRef, useState } from "react";

/** "⭳ Download ▾" with Word and PDF. Closes on an outside click or Escape. */
export default function DownloadMenu({ onWord, onPdf, disabled, label = "⭳ Download", title }: { onWord: () => void; onPdf: () => void; disabled?: boolean; label?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const item: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, padding: "8px 12px", fontSize: 12.5, color: "var(--text-primary)", cursor: "pointer", font: "inherit" };
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }} onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="qd-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((v) => !v)}>
        {label} ▾
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 60, minWidth: 210, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", overflow: "hidden" }}>
          <button
            role="menuitem"
            style={item}
            onClick={() => {
              setOpen(false);
              onWord();
            }}
          >
            Word document (.doc)
          </button>
          <button
            role="menuitem"
            style={item}
            onClick={() => {
              setOpen(false);
              onPdf();
            }}
          >
            PDF (choose “Save as PDF”)
          </button>
        </div>
      )}
    </div>
  );
}
