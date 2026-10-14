import { useState } from "react";
import type { AiCommandResult } from "../api";

/**
 * The AI command for the review table: an instruction in any words, run over the rows in scope. Preview shows what
 * would change for each row; Apply writes it. The model's answer is only ever a plan, so nothing is written without
 * the preview first.
 */

export interface AiCommandProps {
  taxonomies: string[];
  run: (a: { prompt: string; rowIds: string[]; taxonomy: string | null; apply: boolean }) => Promise<AiCommandResult>;
  onApplied: () => Promise<void> | void;
  /** Every row in scope that can be changed (unlocked), in grid order. */
  scopeIds: string[];
  filtersOn: boolean;
  visibleOnly: boolean;
  onVisibleOnly: (v: boolean) => void;
  unsavedCount: number;
}

/** How many rows one run reads. The server enforces the same limit. */
const PER_RUN = 12;

const btn = { padding: "5px 11px", fontSize: 12, cursor: "pointer", border: "1px solid #bbb", background: "#f6f6f6", borderRadius: 4 } as const;
const KIND_LABEL: Record<string, string> = { update: "Update", insert: "Update + new rows", reject: "Reject", none: "No change" };
const KIND_COLOR: Record<string, string> = { update: "#166534", insert: "#166534", reject: "#991b1b", none: "#6b7280" };

export default function AiCommandPanel(p: AiCommandProps) {
  const [prompt, setPrompt] = useState("");
  const [taxonomy, setTaxonomy] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiCommandResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const ids = p.scopeIds.slice(0, PER_RUN);
  const hasChanges = !!result && !result.applied && result.updated + result.inserted + result.rejected > 0;

  async function go(apply: boolean) {
    setMsg(null);
    if (!prompt.trim()) return setMsg("Say what you want done.");
    if (ids.length === 0) return setMsg("No rows are in scope.");
    if (apply && p.unsavedCount > 0) return setMsg("Save your unsaved changes first, so the AI does not overwrite them.");
    if (apply && !window.confirm(`Apply this to ${ids.length} row${ids.length === 1 ? "" : "s"}? It writes straight to the review table, and it cannot be undone from the grid.`)) return;
    setBusy(true);
    try {
      const r = await p.run({ prompt, rowIds: ids, taxonomy: taxonomy || null, apply });
      if (r.error) {
        setMsg(r.error);
        setResult(null);
        return;
      }
      if (apply && r.applied) {
        setResult(null);
        await p.onApplied();
        setMsg(`Applied: ${r.updated} updated, ${r.inserted} new row${r.inserted === 1 ? "" : "s"}, ${r.rejected} rejected.`);
        return;
      }
      setResult(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "The AI command did not run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "0 0 8px", padding: "8px 10px", border: "1px solid var(--border-soft, #ddd)", borderRadius: 8, background: "var(--panel, #fff)", fontSize: 12.5 }}>
      <textarea
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); setResult(null); }}
        rows={3}
        placeholder="Say what to do, in any words. e.g. Read each article. If it is a security or conflict incident, code its country, city, sector, actor and tactic from the taxonomy. If it reports more than one incident, add each one as its own row."
        aria-label="AI instruction"
        style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", fontSize: 13, border: "1px solid var(--border, #ccc)", borderRadius: 6, background: "transparent", color: "inherit", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <select value={taxonomy} onChange={(e) => { setTaxonomy(e.target.value); setResult(null); }} aria-label="Taxonomy" style={{ fontSize: 12, padding: 4 }}>
          <option value="">No taxonomy (the instruction alone)</option>
          {p.taxonomies.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button type="button" style={btn} disabled={busy || !prompt.trim()} onClick={() => go(false)}>{busy ? "Working…" : "Preview with AI"}</button>
        <button type="button" style={{ ...btn, background: hasChanges ? "#166534" : "#f6f6f6", color: hasChanges ? "#fff" : "inherit" }} disabled={busy || !hasChanges} onClick={() => go(true)}>
          Apply{hasChanges ? ` to ${result!.updated + result!.inserted + result!.rejected} row${result!.updated + result!.inserted + result!.rejected === 1 ? "" : "s"}` : ""}
        </button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, color: "var(--text-muted, #555)" }}>
        <input type="checkbox" checked={p.visibleOnly} disabled={!p.filtersOn} onChange={(e) => { p.onVisibleOnly(e.target.checked); setResult(null); }} />
        {p.filtersOn ? "Only the rows I can see" : "All rows (no filters are on)"}
      </label>
      <div style={{ marginTop: 4, color: "var(--text-faint, #888)" }}>
        {ids.length} row{ids.length === 1 ? "" : "s"} in scope{p.scopeIds.length > PER_RUN ? `; the first ${PER_RUN} are read per run, so run again for the rest` : ""}. Each article is read in full, and the AI only proposes changes; nothing is written until you Apply.
      </div>

      {msg && <div role="status" style={{ marginTop: 6, color: "#b91c1c" }}>{msg}</div>}
      {result && (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 4 }}>
            <b>Preview:</b> {result.rows_seen} read · {result.updated} to update · {result.inserted} new row{result.inserted === 1 ? "" : "s"} · {result.rejected} to reject
          </div>
          {result.warnings.map((w, i) => (
            <div key={i} style={{ color: "#92400e", marginBottom: 2 }}>{w}</div>
          ))}
          <ul style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none", maxHeight: 280, overflowY: "auto" }}>
            {result.plan.slice(0, 100).map((it) => (
              <li key={it.rowId} style={{ padding: "6px 0", borderTop: "1px solid var(--border-soft, #eee)" }}>
                <span style={{ fontWeight: 700, color: KIND_COLOR[it.kind] }}>{KIND_LABEL[it.kind]}</span>{" "}
                <span>{it.note}</span>
                {it.changes.length > 0 && (
                  <div style={{ marginTop: 2, paddingLeft: 10, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>
                    {it.changes.map((c) => (
                      <div key={c.field}>
                        <b>{c.field}</b>: {c.before ? <s style={{ color: "#888" }}>{c.before}</s> : <i style={{ color: "#888" }}>empty</i>} → {c.after}
                      </div>
                    ))}
                  </div>
                )}
                {it.inserts.map((n, k) => (
                  <div key={k} style={{ marginTop: 2, paddingLeft: 10, fontSize: 11.5 }}>
                    + new row: {Object.entries(n.fields).map(([f, v]) => `${f} = ${v}`).join(" · ")}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          {result.plan.length > 100 && <div style={{ color: "var(--text-faint, #888)" }}>Showing the first 100 of {result.plan.length} rows.</div>}
        </div>
      )}
      <div style={{ marginTop: 8, color: "var(--text-faint, #888)" }}>
        Applied changes are saved on the server straight away, so they are not in the Undo list. Use the review table to correct any row afterwards.
      </div>
    </div>
  );
}
