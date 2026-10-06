import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardWidget } from "../../api";
import { useOwnSelection, useViz } from "./context";
import { buildPivot, pivotToSheet } from "./charts/Pivot";
import VizBody, { flatTable, HAS_TABLE_VIEW } from "./VizBody";
import { KIND, type VizResult } from "./types";
import "./viz.css";

/**
 * A visual on a dashboard: the card around it (the handle it is dragged by,
 * its title, its controls) and the visual itself. The card looks and moves
 * like the dashboard's older widgets, so the two kinds sit together.
 */

interface Props {
  widget: DashboardWidget;
  /** The dashboard can be edited (not locked, not a shared view). */
  editable: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onRename?: (title: string) => void;
  onToggleLock?: () => void;
}

/** A spreadsheet runs a cell that starts with = + - or @ as a formula; data from anywhere must never run as one. */
const safeCell = (v: string | number | null) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : (v ?? ""));

function saveBlob(content: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The image library draws a soft card shadow as a solid grey frame; the copy it photographs goes without shadows. */
export function flattenForCapture(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = ".panel{box-shadow:none !important}";
  doc.head.appendChild(style);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "visual";

export default function VizCard({ widget, editable, onEdit, onRemove, onRename, onToggleLock }: Props) {
  const viz = widget.viz;
  const ctx = useViz();
  const own = useOwnSelection(widget.id);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const data = useRef<VizResult | null>(null);
  const [hasData, setHasData] = useState(false);
  const onData = useCallback((r: VizResult | null) => {
    data.current = r;
    setHasData(!!r && r.rows.length > 0);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuBox.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!viz) return <div className="panel vz-card vz-empty">This visual has no definition.</div>;
  const meta = KIND[viz.kind];
  const locked = !!widget.locked;
  const canTable = HAS_TABLE_VIEW.has(viz.kind);
  const canExport = hasData && viz.kind !== "text" && viz.kind !== "slicer";
  const name = `${slug(widget.title)}_${new Date().toISOString().slice(0, 10)}`;
  // A text card's heading is its title; saying it twice helps nobody.
  const hideTitle = viz.kind === "text" && (!widget.title.trim() || widget.title === "Text card" || widget.title.trim() === (viz.options?.heading ?? "").trim());

  const sheet = (): (string | number | null)[][] => {
    const result = data.current;
    if (!result) return [];
    // Sums of decimals pick up stray digits (500.90000000000003); nobody wants those in a spreadsheet.
    const tidy = (rows: (string | number | null)[][]) => rows.map((r) => r.map((v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(6)) : v)));
    if (viz.kind === "pivot") return tidy(pivotToSheet(buildPivot(viz, result)));
    const flat = flatTable(viz, result);
    return tidy([flat.columns, ...flat.rows]);
  };

  async function download(format: "csv" | "xlsx" | "png") {
    setBusy(true);
    setFailed(null);
    try {
      if (format === "png") {
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(card.current!, { useCORS: true, logging: false, backgroundColor: ctx.theme.surface, scale: 2, onclone: flattenForCapture });
        await new Promise<void>((done) => canvas.toBlob((blob) => (blob && saveBlob(blob, "image/png", `${name}.png`), done())));
      } else if (format === "csv") {
        const cell = (v: string | number | null) => {
          const s = String(safeCell(v));
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        // The leading mark makes Excel read the file as UTF-8, so accents and Arabic survive.
        saveBlob(
          `﻿${sheet()
            .map((r) => r.map(cell).join(","))
            .join("\r\n")}`,
          "text/csv;charset=utf-8",
          `${name}.csv`,
        );
      } else {
        const XLSX = await import("xlsx");
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet().map((r) => r.map(safeCell))), widget.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Data");
        XLSX.writeFile(book, `${name}.xlsx`);
      }
      setMenu(false);
    } catch {
      setFailed("That download could not be made. Try another format.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={card} className={`panel vz-card vz-card--${viz.kind}${own ? " is-filtering" : ""}`}>
      <header className="vz-card__head">
        {editable && !locked && (
          <span className="widget-drag-handle vz-card__grip" title="Drag from here to move this visual" aria-hidden data-html2canvas-ignore>
            ⣿
          </span>
        )}
        <div className="vz-card__titles">
          {hideTitle ? null : editable && onRename && !locked ? (
            <input className="vz-card__title no-drag" value={widget.title} onChange={(e) => onRename(e.target.value)} onMouseDown={(e) => e.stopPropagation()} aria-label="Title of this visual" />
          ) : (
            <div className="vz-card__title" title={widget.title}>
              {widget.title}
            </div>
          )}
          {widget.label && <div className="vz-card__caption">{widget.label}</div>}
        </div>
        {own && (
          <button
            type="button"
            className="vz-chip no-drag"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => ctx.select(widget.id, null)}
            title="This visual is filtering the others. Click to clear."
          >
            {own.label} ✕
          </button>
        )}
        {/* The controls stay out of the way until the card is pointed at or focused, so a dashboard reads as charts, not buttons. */}
        <div className={`vz-card__actions no-drag${menu ? " is-open" : ""}`} onMouseDown={(e) => e.stopPropagation()} data-html2canvas-ignore>
          {canTable && hasData && (
            <div className="vz-seg" role="group" aria-label="Show as">
              {(["chart", "table"] as const).map((v) => (
                <button key={v} type="button" className={view === v ? "is-on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === "chart" ? "Chart" : "Table"}
                </button>
              ))}
            </div>
          )}
          {(canExport || viz.kind === "text") && (
            <div className="vz-menu" ref={menuBox}>
              <button type="button" className="vz-icon" aria-haspopup="menu" aria-expanded={menu} title="Download" onClick={() => setMenu((v) => !v)}>
                ⭳
              </button>
              {menu && (
                <div className="vz-menu__list" role="menu">
                  {canExport && (
                    <>
                      <button type="button" role="menuitem" disabled={busy} onClick={() => download("xlsx")}>
                        The figures, as Excel
                      </button>
                      <button type="button" role="menuitem" disabled={busy} onClick={() => download("csv")}>
                        The figures, as CSV
                      </button>
                    </>
                  )}
                  <button type="button" role="menuitem" disabled={busy} onClick={() => download("png")}>
                    {busy ? "Preparing…" : "This visual, as an image"}
                  </button>
                  {failed && <div className="vz-menu__note">{failed}</div>}
                </div>
              )}
            </div>
          )}
          {editable && onToggleLock && (
            <button type="button" className={`vz-icon${locked ? " is-on" : ""}`} onClick={onToggleLock} title={locked ? "Unlock this visual" : "Lock this visual in place"}>
              {locked ? "🔒" : "🔓"}
            </button>
          )}
          {editable && !locked && onEdit && (
            <button type="button" className="vz-icon" onClick={onEdit} title={`Change this ${meta?.label.toLowerCase() ?? "visual"}`}>
              ⚙
            </button>
          )}
          {editable && !locked && onRemove && (
            <button type="button" className="vz-icon vz-icon--danger" onClick={onRemove} title="Remove this visual">
              ×
            </button>
          )}
        </div>
      </header>
      <div className="vz-card__body">
        <VizBody widgetId={widget.id} viz={viz} view={view} title={widget.title} onData={onData} />
      </div>
    </div>
  );
}
