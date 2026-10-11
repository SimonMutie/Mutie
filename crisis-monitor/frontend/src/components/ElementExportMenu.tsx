import { useEffect, useRef, useState } from "react";
import type { ElementFormat } from "../report/elementExport";

export type ExportChoice = ElementFormat | "gif";

const OPTIONS: { fmt: ExportChoice; label: string; hint: string }[] = [
  { fmt: "pdf", label: "PDF", hint: "The section as it looks, A4 pages" },
  { fmt: "docx", label: "Word", hint: "Text, table and a picture of the section" },
  { fmt: "pptx", label: "PowerPoint", hint: "One animated slide, editable text" },
  { fmt: "gif", label: "GIF", hint: "The section’s motion, recorded" },
];

/** The section download menu. Disabled with a reason when the section is hidden, since there is nothing to draw. */
export default function ElementExportMenu({
  busy,
  disabled,
  reason,
  onPick,
  formats,
}: {
  busy?: string | null;
  disabled?: boolean;
  reason?: string;
  onPick: (fmt: ExportChoice) => void;
  formats?: ExportChoice[];
}) {
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

  return (
    <div ref={ref} className="el-export">
      <button
        type="button"
        className="el-sec-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || Boolean(busy)}
        title={disabled ? reason : "Download this section"}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ?? "Download ▾"}
      </button>
      {open && !disabled && (
        <div role="menu" className="el-export__menu">
          {OPTIONS.filter((o) => !formats || formats.includes(o.fmt)).map((o) => (
            <button
              key={o.fmt}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(o.fmt);
              }}
            >
              <b>{o.label}</b>
              <small>{o.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
