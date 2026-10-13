import { useEffect, useState } from "react";
import { api, type StagingScriptResult } from "../api";

/**
 * The review script (admins). Write a few Python-style lines to work through the
 * pending rows: open the article, code it against a saved taxonomy, fill fields,
 * approve or reject. Preview shows what would change; Run saves it. Nothing
 * reaches the incidents table from here; that still needs the Push step.
 */

const SAMPLE = `# Work through the rows waiting for review
for row in pending where country = "Sudan":
    open(row)
    code(row, taxonomy="Incident coding")
    approve(row)

for row in pending:
    print("left for a person to check")`;

const btn = { padding: "5px 11px", fontSize: 12, cursor: "pointer", border: "1px solid #bbb", background: "#f6f6f6", borderRadius: 4 } as const;
const area = { width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12, padding: 8, border: "1px solid #ccc", borderRadius: 4, boxSizing: "border-box" } as const;

export default function StagingScriptPanel() {
  const [script, setScript] = useState(SAMPLE);
  const [taxonomies, setTaxonomies] = useState<{ name: string; updated_at: string }[]>([]);
  const [taxName, setTaxName] = useState("");
  const [taxBody, setTaxBody] = useState("");
  const [result, setResult] = useState<StagingScriptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadList = () => api.stagingTaxonomies().then(setTaxonomies).catch(() => setTaxonomies([]));
  useEffect(() => {
    loadList();
  }, []);

  async function openTaxonomy(name: string) {
    setTaxName(name);
    try {
      const t = await api.stagingTaxonomy(name);
      setTaxBody(t.body);
      setMsg(null);
    } catch {
      setMsg("That taxonomy could not be opened.");
    }
  }

  async function saveTaxonomy() {
    const name = taxName.trim();
    if (!name || !taxBody.trim()) {
      setMsg("Give the taxonomy a name and some text.");
      return;
    }
    try {
      await api.stagingSaveTaxonomy(name, taxBody);
      setMsg(`Saved taxonomy "${name}".`);
      loadList();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "The taxonomy did not save.");
    }
  }

  async function go(apply: boolean) {
    if (apply && !window.confirm("Run the script and save the changes to the review rows? Rows already pushed are not touched.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.stagingScript({ script, apply });
      setResult(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "The script did not run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ddd" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Review script</h3>
      <p style={{ margin: "0 0 8px", color: "#555" }}>
        Steps: <code>open(row)</code> reads the article, <code>code(row, taxonomy="NAME")</code> fills empty fields from a saved taxonomy,
        <code> fill(row, field="value")</code> sets fields, <code>approve(row)</code> / <code>reject(row)</code> set the status,
        <code> print("text")</code> writes to the log. Use <code>for row in pending where country = "Sudan":</code> to choose rows.
      </p>
      <textarea style={{ ...area, minHeight: 160 }} value={script} onChange={(e) => setScript(e.target.value)} aria-label="Review script" />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button style={btn} disabled={busy} onClick={() => go(false)}>{busy ? "Working…" : "Preview"}</button>
        <button style={btn} disabled={busy} onClick={() => go(true)}>Run and save</button>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer" }}>Incident coding taxonomy ({taxonomies.length} saved)</summary>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value="" onChange={(e) => e.target.value && openTaxonomy(e.target.value)} aria-label="Open a saved taxonomy" style={{ fontSize: 12, padding: 4 }}>
            <option value="">Open a saved taxonomy…</option>
            {taxonomies.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <input value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="Name, e.g. Incident coding" aria-label="Taxonomy name" style={{ fontSize: 12, padding: 4, width: 240 }} />
          <label style={{ fontSize: 12 }}>
            or upload a text, CSV or JSON file{" "}
            <input
              type="file"
              accept=".txt,.csv,.json,.md,text/plain,text/csv,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setTaxBody(await f.text());
                if (!taxName) setTaxName(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </label>
        </div>
        <textarea style={{ ...area, minHeight: 140, marginTop: 8 }} value={taxBody} onChange={(e) => setTaxBody(e.target.value)} placeholder="Paste the coding taxonomy: each field, the allowed values and when to use them." aria-label="Taxonomy text" />
        <div style={{ marginTop: 6 }}>
          <button style={btn} onClick={saveTaxonomy}>Save taxonomy</button>
        </div>
      </details>

      {msg && <p role="status" style={{ marginTop: 10, color: "#7a1f1f" }}>{msg}</p>}

      {result && (
        <div style={{ marginTop: 14 }}>
          {result.error ? (
            <p style={{ color: "#991b1b" }}>Line {result.error.line}: {result.error.message}</p>
          ) : (
            <p style={{ margin: "0 0 6px" }}>
              {result.applied ? "Saved." : "Preview only, nothing saved."} {result.rows_seen} row{result.rows_seen === 1 ? "" : "s"} looked at, {result.rows_changed} would change{result.applied ? " and were saved" : ""}.
            </p>
          )}
          {result.log.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>
              {result.log.map((l, i) => (
                <li key={i} style={{ color: l.level === "warn" ? "#92400e" : l.level === "error" ? "#991b1b" : "#333" }}>
                  {l.row ? `${l.row}  ` : ""}
                  {l.text}
                </li>
              ))}
            </ul>
          )}
          {result.changes.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                    <th style={{ padding: 4 }}>Row</th>
                    <th style={{ padding: 4 }}>Status</th>
                    <th style={{ padding: 4 }}>Fields</th>
                    <th style={{ padding: 4 }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {result.changes.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                      <td style={{ padding: 4, fontFamily: "monospace" }}>{c.id.slice(0, 8)}</td>
                      <td style={{ padding: 4 }}>{c.status_from === c.status_to ? c.status_to : `${c.status_from} → ${c.status_to}`}</td>
                      <td style={{ padding: 4 }}>
                        {c.changed_fields.map((f) => (
                          <div key={f}>
                            <b>{f}</b>: {String(c.row[f] ?? "")}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: 4 }}>
                        {c.source_url ? (
                          <a href={c.source_url} target="_blank" rel="noreferrer noopener">open</a>
                        ) : (
                          "none"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
