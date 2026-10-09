import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * A spreadsheet-style grid for editing incident rows, with what Excel users expect:
 *  - a filter button on every column header (pick values, search, sort A→Z / Z→A) and a "clear filters" link;
 *  - click a cell to select it, Shift+click to extend down the column;
 *  - the small square at the corner of the selection: drag it down to fill, or double-click it to fill down as far
 *    as the neighbouring column has data (the way Excel does);
 *  - Ctrl+D fills the selection down from its first cell; Enter / ↑ / ↓ move between rows;
 *  - paste from Excel: several lines fill down, tab-separated cells fill across;
 *  - every change is listed with its own Save and Undo (Ctrl+Z / Ctrl+Y too), and "Save all" saves the lot. Changes
 *    wait to be saved unless "Save as I go" is ticked.
 * The parent owns the rows: onEdit shows a change on screen, onSave stores it.
 */

export interface SheetColumn {
  key: string;
  label: string;
  width: number;
  num?: boolean;
}
export interface SheetEdit {
  id: string;
  key: string;
  value: string | number | null;
}
/** One change the person made: a typed cell, a fill, a paste. It can be saved or undone on its own. */
interface Change {
  n: number;
  label: string;
  edits: (SheetEdit & { before: string | number | null })[];
  status: "pending" | "saving" | "saved" | "error";
  error?: string;
}

interface Props<T> {
  rows: T[];
  rowId: (r: T) => string;
  columns: SheetColumn[];
  getValue: (r: T, key: string) => string | number | null | undefined;
  /** Shows the edits on screen. */
  onEdit: (edits: SheetEdit[]) => void;
  /** Stores the edits (rejects if it could not). */
  onSave: (edits: SheetEdit[]) => Promise<void>;
  isLocked?: (r: T) => boolean;
  /** Cells to the left of the data columns (a checkbox, approve / reject buttons). */
  lead?: { header: ReactNode; width: number; cell: (r: T) => ReactNode };
  /** Cells to the right of the data columns. */
  tail?: { header: ReactNode; width: number; cell: (r: T) => ReactNode };
  rowStyle?: (r: T) => React.CSSProperties;
  maxHeight?: string;
  /** Reports how many rows the filters leave, and which, so the page can act on "what I can see". */
  onVisible?: (rows: T[]) => void;
  empty?: ReactNode;
}

const BLANK = "(Blanks)";
const text = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const parse = (raw: string, num?: boolean): string | number | null => {
  if (raw.trim() === "") return null;
  if (num) {
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return raw;
};

interface Sel {
  col: number;
  from: number;
  to: number;
}

export default function SheetGrid<T>({ rows, rowId, columns, getValue, onEdit, onSave, isLocked, lead, tail, rowStyle, maxHeight = "60vh", onVisible, empty }: Props<T>) {
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [sel, setSel] = useState<Sel | null>(null);
  const [drag, setDrag] = useState<{ end: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const focusValue = useRef<string>("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [redo, setRedo] = useState<Change[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const counter = useRef(0);
  const byId = useMemo(() => new Map(rows.map((r) => [rowId(r), r])), [rows, rowId]);
  const current = (id: string, key: string) => {
    const r = byId.get(id);
    return r === undefined ? null : (getValue(r, key) ?? null);
  };

  const patch = (n: number, p: Partial<Change>) => setChanges((all) => all.map((c) => (c.n === n ? { ...c, ...p } : c)));
  const saveChange = useCallback(
    async (c: Change) => {
      patch(c.n, { status: "saving", error: undefined });
      try {
        await onSave(c.edits.map(({ id, key, value }) => ({ id, key, value })));
        patch(c.n, { status: "saved" });
      } catch (e) {
        patch(c.n, { status: "error", error: e instanceof Error ? e.message : "Could not save" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSave],
  );
  function addChange(label: string, edits: Change["edits"]) {
    if (edits.length === 0) return;
    const c: Change = { n: ++counter.current, label, edits, status: "pending" };
    setChanges((all) => [...all, c].slice(-200));
    setRedo([]);
    if (autoSave) void saveChange(c);
  }
  /** A change made by the grid itself (a fill or a paste): shown on screen and recorded. */
  function commit(label: string, edits: SheetEdit[]) {
    const withBefore = edits.map((e) => ({ ...e, before: current(e.id, e.key) })).filter((e) => text(e.before) !== text(e.value));
    if (withBefore.length === 0) return;
    onEdit(withBefore.map(({ id, key, value }) => ({ id, key, value })));
    addChange(label, withBefore);
  }
  function undoChange(c: Change) {
    if (c.status === "saving") return;
    const back = c.edits.map(({ id, key, before }) => ({ id, key, value: before }));
    onEdit(back);
    if (c.status === "saved") void onSave(back).catch(() => undefined); // taking back what was stored
    setChanges((all) => all.filter((x) => x.n !== c.n));
    setRedo((r) => [...r, c]);
  }
  function redoChange() {
    const c = redo[redo.length - 1];
    if (!c) return;
    setRedo((r) => r.slice(0, -1));
    onEdit(c.edits.map(({ id, key, value }) => ({ id, key, value })));
    const again: Change = { ...c, n: ++counter.current, status: "pending", error: undefined };
    setChanges((all) => [...all, again]);
    if (autoSave) void saveChange(again);
  }
  const unsaved = changes.filter((c) => c.status === "pending" || c.status === "error");
  async function saveAll() {
    for (const c of unsaved) await saveChange(c);
  }
  function undoLast() {
    const c = [...changes].reverse().find((x) => x.status !== "saving");
    if (c) undoChange(c);
  }
  // Leaving the page with changes that were never saved.
  useEffect(() => {
    if (unsaved.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved.length]);

  const visible = useMemo(() => {
    let out = rows.filter((r) => Object.entries(filters).every(([k, set]) => set.has(text(getValue(r, k)) || BLANK)));
    if (sort) {
      const { key, dir } = sort;
      const num = columns.find((c) => c.key === key)?.num;
      out = [...out].sort((a, b) => {
        const x = getValue(a, key);
        const y = getValue(b, key);
        if (num) return (Number(x ?? -Infinity) - Number(y ?? -Infinity)) * dir;
        return text(x).localeCompare(text(y), undefined, { numeric: true }) * dir;
      });
    }
    return out;
  }, [rows, filters, sort, columns, getValue]);
  useEffect(() => onVisible?.(visible), [visible, onVisible]);
  // A selection that no longer exists (rows filtered away) is dropped.
  useEffect(() => setSel((s) => (s && s.to < visible.length ? s : null)), [visible.length]);

  const filterCount = Object.keys(filters).length;

  /* ── filters ── */
  const valuesFor = useCallback(
    (key: string) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const v = text(getValue(r, key)) || BLANK;
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => (a[0] === BLANK ? 1 : b[0] === BLANK ? -1 : a[0].localeCompare(b[0], undefined, { numeric: true })));
    },
    [rows, getValue],
  );
  const menuValues = useMemo(() => (menu ? valuesFor(menu.key) : []), [menu, valuesFor]);
  const shownValues = menuValues.filter(([v]) => v.toLowerCase().includes(menuSearch.toLowerCase())).slice(0, 300);
  const chosen = menu ? (filters[menu.key] ?? new Set(menuValues.map(([v]) => v))) : new Set<string>();

  function setChosen(key: string, next: Set<string>) {
    setFilters((f) => {
      const all = valuesFor(key).length;
      const copy = { ...f };
      if (next.size >= all) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-sheet-menu]")) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  /* ── editing and filling ── */
  const colIndex = (key: string) => columns.findIndex((c) => c.key === key);

  function fill(col: number, from: number, source: number[], toRow: number) {
    // `source` is the rows whose values are repeated (the selection); cells from..toRow take them in turn.
    const c = columns[col];
    const vals = source.map((i) => getValue(visible[i], c.key));
    const edits: SheetEdit[] = [];
    for (let r = from; r <= toRow; r++) {
      if (r < 0 || r >= visible.length || isLocked?.(visible[r])) continue;
      const v = vals[(r - from) % vals.length];
      edits.push({ id: rowId(visible[r]), key: c.key, value: v === undefined ? null : v });
    }
    if (edits.length) commit(`${c.label}: filled ${edits.length} cell${edits.length === 1 ? "" : "s"}${vals[0] !== undefined && vals[0] !== null ? ` with “${text(vals[0]).slice(0, 30)}”` : ""}`, edits);
  }
  /** Excel's double-click: fill down as far as the neighbouring column has data. */
  function autoFillEnd(s: Sel): number {
    const filled = (col: number, r: number) => col >= 0 && col < columns.length && text(getValue(visible[r], columns[col].key)) !== "";
    for (const side of [s.col - 1, s.col + 1]) {
      if (side < 0 || side >= columns.length || s.to + 1 >= visible.length || !filled(side, s.to + 1)) continue;
      let end = s.to + 1;
      while (end + 1 < visible.length && filled(side, end + 1)) end++;
      return end;
    }
    return visible.length - 1;
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>, col: number, row: number) {
    const move = (dr: number) => {
      const next = wrap.current?.querySelector<HTMLInputElement>(`input[data-cell="${col}:${row + dr}"]`);
      if (next) {
        e.preventDefault();
        next.focus();
        next.select();
      }
    };
    if (e.key === "Enter" || e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoLast();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      redoChange();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && sel) {
      e.preventDefault();
      const lo = Math.min(sel.from, sel.to);
      const hi = Math.max(sel.from, sel.to);
      if (hi > lo) fill(sel.col, lo + 1, [lo], hi);
      else if (lo > 0) fill(sel.col, lo, [lo - 1], lo); // a single cell takes the value from the cell above, as in Excel
    }
  }
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, col: number, row: number) {
    const raw = e.clipboardData.getData("text");
    if (!/[\n\t]/.test(raw.replace(/\r?\n$/, ""))) return; // a single value pastes normally
    e.preventDefault();
    const lines = raw.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => l.split("\t"));
    const edits: SheetEdit[] = [];
    lines.forEach((cells, dr) =>
      cells.forEach((v, dc) => {
        const r = row + dr;
        const c = columns[col + dc];
        if (!c || r >= visible.length || isLocked?.(visible[r])) return;
        edits.push({ id: rowId(visible[r]), key: c.key, value: parse(v, c.num) });
      }),
    );
    if (edits.length) commit(`Pasted ${edits.length} cell${edits.length === 1 ? "" : "s"}`, edits);
  }

  // Finishing a drag of the fill handle.
  useEffect(() => {
    if (!drag || !sel) return;
    const up = () => {
      const lo = Math.min(sel.from, sel.to);
      const hi = Math.max(sel.from, sel.to);
      if (drag.end > hi) {
        fill(sel.col, hi + 1, Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), drag.end);
        setSel({ col: sel.col, from: lo, to: drag.end });
      }
      setDrag(null);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, sel]);

  const hi = sel ? Math.max(sel.from, sel.to) : -1;
  const lo = sel ? Math.min(sel.from, sel.to) : -1;
  const dragHi = drag ? drag.end : hi;
  const th: React.CSSProperties = { padding: "6px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-muted, #555)", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", whiteSpace: "nowrap", background: "var(--panel-raised, #eee)", position: "sticky", top: 0, zIndex: 2 };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 8px", padding: "6px 8px", border: "1px solid var(--border-soft, #ddd)", borderRadius: 8, background: "var(--panel, #fff)", fontSize: 12.5, position: "relative" }}>
        <b style={{ color: unsaved.length ? "#a16207" : "var(--text-muted, #555)" }}>{unsaved.length ? `${unsaved.length} unsaved change${unsaved.length === 1 ? "" : "s"}` : changes.length ? "All changes saved" : "No changes yet"}</b>
        <button type="button" style={barBtn(unsaved.length > 0, true)} disabled={unsaved.length === 0} onClick={() => void saveAll()}>Save all</button>
        <button type="button" style={barBtn(changes.length > 0)} disabled={changes.length === 0} onClick={undoLast} title="Undo the last change (Ctrl+Z)">↶ Undo</button>
        <button type="button" style={barBtn(redo.length > 0)} disabled={redo.length === 0} onClick={redoChange} title="Redo (Ctrl+Y)">↷ Redo</button>
        <button type="button" style={barBtn(changes.length > 0)} disabled={changes.length === 0} onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide changes" : `Changes (${changes.length})`}</button>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted, #555)", cursor: "pointer" }}>
          <input type="checkbox" checked={autoSave} onChange={(e) => { setAutoSave(e.target.checked); if (e.target.checked) void saveAll(); }} />
          Save as I go
        </label>
      </div>
      {showLog && changes.length > 0 && (
        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-soft, #ddd)", borderRadius: 8, marginBottom: 8, background: "var(--panel, #fff)" }}>
          {[...changes].reverse().map((c) => (
            <div key={c.n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid var(--border-soft, #eee)", fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.label}>{c.label}</span>
              <span style={{ color: c.status === "saved" ? "#166534" : c.status === "error" ? "#991b1b" : "#a16207", whiteSpace: "nowrap" }} title={c.error}>
                {c.status === "saved" ? "✓ Saved" : c.status === "saving" ? "Saving…" : c.status === "error" ? "Not saved" : "Unsaved"}
              </span>
              {(c.status === "pending" || c.status === "error") && <button type="button" style={barBtn(true, true)} onClick={() => void saveChange(c)}>Save</button>}
              <button type="button" style={barBtn(c.status !== "saving")} disabled={c.status === "saving"} onClick={() => undoChange(c)}>Undo</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-muted, #555)", marginBottom: 6, flexWrap: "wrap" }}>
        <span>
          {visible.length.toLocaleString()} of {rows.length.toLocaleString()} rows
          {filterCount > 0 ? ` · ${filterCount} filter${filterCount === 1 ? "" : "s"} on` : ""}
        </span>
        {(filterCount > 0 || sort) && (
          <button type="button" onClick={() => { setFilters({}); setSort(null); }} style={{ fontSize: 12, background: "none", border: "none", color: "var(--signal, #0d9488)", cursor: "pointer", textDecoration: "underline" }}>
            Clear filters and sort
          </button>
        )}
        <span style={{ marginLeft: "auto", color: "var(--text-faint, #888)" }}>Drag or double-click the square at a cell's corner to fill down · Ctrl+D fills down · paste from Excel</span>
      </div>

      <div ref={wrap} style={{ overflow: "auto", maxHeight, border: "1px solid var(--border-soft, #ddd)", borderRadius: 8 }} onMouseUp={() => undefined}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
          <thead>
            <tr>
              {lead && <th style={{ ...th, width: lead.width }}>{lead.header}</th>}
              {columns.map((c) => {
                const active = !!filters[c.key];
                return (
                  <th key={c.key} style={{ ...th, minWidth: c.width }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {c.label}
                      {sort?.key === c.key && <span>{sort.dir === 1 ? "▲" : "▼"}</span>}
                      <button
                        type="button"
                        title={`Filter ${c.label}`}
                        data-sheet-menu
                        onClick={(e) => {
                          const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setMenuSearch("");
                          setMenu(menu?.key === c.key ? null : { key: c.key, x: Math.min(b.left, window.innerWidth - 260), y: b.bottom + 4 });
                        }}
                        style={{ border: "1px solid " + (active ? "var(--signal, #0d9488)" : "var(--border, #ccc)"), background: active ? "var(--signal-dim, #d5f0ec)" : "var(--panel, #fff)", color: active ? "var(--signal, #0d9488)" : "var(--text-muted, #666)", borderRadius: 3, fontSize: 9, lineHeight: 1, padding: "3px 4px", cursor: "pointer" }}
                      >
                        ▼
                      </button>
                    </span>
                  </th>
                );
              })}
              {tail && <th style={{ ...th, width: tail.width }}>{tail.header}</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + (lead ? 1 : 0) + (tail ? 1 : 0)} style={{ padding: 20, color: "var(--text-faint, #777)", textAlign: "center" }}>
                  {rows.length > 0 ? "No rows match the filters." : empty ?? "Nothing here."}
                </td>
              </tr>
            )}
            {visible.map((r, ri) => {
              const locked = isLocked?.(r) ?? false;
              return (
                <tr key={rowId(r)} style={{ borderTop: "1px solid var(--border-soft, #e5e5e5)", ...rowStyle?.(r) }}>
                  {lead && <td style={{ padding: 4, whiteSpace: "nowrap" }}>{lead.cell(r)}</td>}
                  {columns.map((c, ci) => {
                    const inSel = sel?.col === ci && ri >= lo && ri <= dragHi;
                    const handle = sel?.col === ci && ri === dragHi && !locked;
                    return (
                      <td
                        key={c.key}
                        style={{ padding: 0, position: "relative", outline: inSel ? "2px solid var(--signal, #0d9488)" : undefined, outlineOffset: -1, background: inSel && ri > hi ? "var(--signal-dim, #d5f0ec)" : undefined }}
                        onMouseEnter={() => drag && sel?.col === ci && setDrag({ end: Math.max(ri, hi) })}
                      >
                        <input
                          data-cell={`${ci}:${ri}`}
                          disabled={locked}
                          value={text(getValue(r, c.key))}
                          onFocus={() => {
                            focusValue.current = text(getValue(r, c.key));
                            setSel((s) => (s && s.col === ci && s.from === ri && s.to === ri ? s : { col: ci, from: ri, to: ri }));
                          }}
                          onClick={(e) => {
                            if (e.shiftKey && sel && sel.col === ci) setSel({ col: ci, from: sel.from, to: ri });
                          }}
                          onChange={(e) => onEdit([{ id: rowId(r), key: c.key, value: e.target.value }])}
                          onBlur={() => {
                            // One change per finished edit of a cell, and only if the cell actually changed.
                            const now = text(getValue(r, c.key));
                            if (now === focusValue.current) return;
                            const before = parse(focusValue.current, c.num);
                            const after = parse(now, c.num);
                            onEdit([{ id: rowId(r), key: c.key, value: after }]);
                            addChange(`${c.label}: ${focusValue.current ? `“${focusValue.current.slice(0, 24)}”` : "blank"} → ${now ? `“${now.slice(0, 24)}”` : "blank"}`, [{ id: rowId(r), key: c.key, value: after, before }]);
                          }}
                          onKeyDown={(e) => onKey(e, ci, ri)}
                          onPaste={(e) => onPaste(e, ci, ri)}
                          style={{ width: "100%", minWidth: c.width, boxSizing: "border-box", padding: "5px 7px", border: "none", background: "transparent", color: "inherit", fontSize: 12, fontFamily: "inherit", outline: "none" }}
                        />
                        {handle && (
                          <span
                            title="Drag to fill down. Double-click to fill as far as the next column has data."
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setDrag({ end: hi });
                            }}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              if (!sel) return;
                              const end = autoFillEnd({ ...sel, from: lo, to: hi });
                              if (end > hi) {
                                fill(sel.col, hi + 1, Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), end);
                                setSel({ col: sel.col, from: lo, to: end });
                              }
                            }}
                            style={{ position: "absolute", right: -4, bottom: -4, width: 8, height: 8, background: "var(--signal, #0d9488)", border: "1px solid #fff", cursor: "crosshair", zIndex: 3 }}
                          />
                        )}
                      </td>
                    );
                  })}
                  {tail && <td style={{ padding: 4, whiteSpace: "nowrap" }}>{tail.cell(r)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {menu && (
        <div data-sheet-menu style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 1000, width: 250, background: "var(--panel, #fff)", color: "var(--text-primary, #111)", border: "1px solid var(--border, #ccc)", borderRadius: 8, boxShadow: "0 8px 24px #0004", padding: 8, fontSize: 12.5 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button type="button" style={menuBtn} onClick={() => setSort({ key: menu.key, dir: 1 })}>Sort A → Z</button>
            <button type="button" style={menuBtn} onClick={() => setSort({ key: menu.key, dir: -1 })}>Sort Z → A</button>
          </div>
          <input value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} placeholder="Search values" autoFocus style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", marginBottom: 6, border: "1px solid var(--border, #ccc)", borderRadius: 5, background: "transparent", color: "inherit" }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <button type="button" style={menuBtn} onClick={() => setChosen(menu.key, new Set(menuValues.map(([v]) => v)))}>Select all</button>
            <button type="button" style={menuBtn} onClick={() => setFilters((f) => ({ ...f, [menu.key]: new Set(menuSearch ? shownValues.map(([v]) => v) : []) }))}>{menuSearch ? "Only these" : "Clear"}</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", borderTop: "1px solid var(--border-soft, #ddd)", paddingTop: 4 }}>
            {shownValues.map(([v, n]) => (
              <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 2px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={chosen.has(v)}
                  onChange={() => {
                    const next = new Set(chosen);
                    if (next.has(v)) next.delete(v);
                    else next.add(v);
                    setChosen(menu.key, next);
                  }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v}>{v}</span>
                <span style={{ color: "var(--text-faint, #888)" }}>{n}</span>
              </label>
            ))}
            {menuValues.length > shownValues.length && !menuSearch && <div style={{ color: "var(--text-faint, #888)", padding: 4 }}>Showing the first 300 values — search to find others.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const menuBtn: React.CSSProperties = { flex: 1, padding: "4px 6px", fontSize: 12, cursor: "pointer", border: "1px solid var(--border, #ccc)", background: "transparent", color: "inherit", borderRadius: 5 };

const barBtn = (on: boolean, primary = false): React.CSSProperties => ({
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 5,
  cursor: on ? "pointer" : "default",
  opacity: on ? 1 : 0.45,
  border: "1px solid " + (primary && on ? "var(--signal, #0d9488)" : "var(--border, #ccc)"),
  background: primary && on ? "var(--signal, #0d9488)" : "transparent",
  color: primary && on ? "#fff" : "inherit",
});
