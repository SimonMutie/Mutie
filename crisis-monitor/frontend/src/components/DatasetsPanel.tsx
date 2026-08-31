import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { api, type Dataset, type DatasetColumn, type DatasetColumnType } from "../api";

/** Samples up to 50 non-empty values per column and votes on a type — "date"
 *  if most values are real Date objects (from XLSX's cellDates parsing) or
 *  look like a date string, "number" if most parse cleanly as numeric,
 *  "text" otherwise. Deliberately conservative (80% threshold) since a wrong
 *  guess is easy to fix by hand in the preview step, but a column silently
 *  mis-typed as "number" when it's really mixed text would break charts. */
export function detectColumnType(values: unknown[]): DatasetColumnType {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "").slice(0, 50);
  if (sample.length === 0) return "text";

  const isDateLike = (v: unknown) => {
    if (v instanceof Date) return true;
    if (typeof v !== "string") return false;
    const s = v.trim();
    if (!/^\d{4}-\d{1,2}-\d{1,2}\b|^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(s)) return false;
    return !Number.isNaN(new Date(s).getTime());
  };
  const isNumberLike = (v: unknown) => {
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v !== "string") return false;
    return /^-?\d+(\.\d+)?$/.test(v.trim().replace(/,/g, ""));
  };

  const dateRatio = sample.filter(isDateLike).length / sample.length;
  const numberRatio = sample.filter(isNumberLike).length / sample.length;
  if (dateRatio >= 0.8) return "date";
  if (numberRatio >= 0.8) return "number";
  return "text";
}

function cellToDatasetValue(value: unknown, type: DatasetColumnType): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (type === "date") {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    // detectColumnType already confirmed this string parses as a real date
    // (isDateLike) — but without normalizing here too, a text-formatted cell
    // like "3/15/2024" would be stored exactly as typed instead of as ISO,
    // and different rows could end up in different formats depending on how
    // each was typed in the original spreadsheet. Sorting or grouping by
    // date (a calendar heatmap, "over time" charts) needs one consistent
    // format to mean anything.
    const parsed = new Date(String(value).trim());
    return Number.isNaN(parsed.getTime()) ? String(value).trim() || null : parsed.toISOString().slice(0, 10);
  }
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return String(value).trim() || null;
}

type Stage = "list" | "upload-pick" | "detecting-schema" | "upload-preview" | "uploading" | "done" | "viewing";

export default function DatasetsPanel() {
  const [stage, setStage] = useState<Stage>("list");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);

  const [fileName, setFileName] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [detectedSchema, setDetectedSchema] = useState<DatasetColumn[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewingDataset, setViewingDataset] = useState<Dataset | null>(null);

  async function loadDatasets() {
    setLoading(true);
    const rows = await api.getDatasets();
    setDatasets(rows);
    setLoading(false);
  }

  useEffect(() => {
    if (stage === "list") loadDatasets();
  }, [stage]);

  /** Yields back to the browser periodically during a large synchronous
   *  pass — without this, detecting types for many columns across tens of
   *  thousands of rows (a full re-scan of every row, once per column) can
   *  block the main thread long enough to trigger the browser's own
   *  "page unresponsive" warning, the same issue this fixed on the
   *  Incidents upload side. */
  async function yieldPeriodically(i: number, every = 1000) {
    if (i > 0 && i % every === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    setDatasetName(file.name.replace(/\.(xlsx?|csv)$/i, ""));
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error("This file doesn't have any sheets.");
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (rawRows.length === 0) throw new Error("No rows found in the first sheet.");

      setStage("detecting-schema");
      const headers = Object.keys(rawRows[0]);
      const schema: DatasetColumn[] = [];
      for (let h = 0; h < headers.length; h++) {
        const name = headers[h];
        schema.push({ name, type: detectColumnType(rawRows.map((r) => r[name])) });
        await yieldPeriodically(h, 3); // each header's own pass is O(rows), so yield after every few headers rather than every row
      }

      setDetectedSchema(schema);
      setParsedRows(rawRows);
      setStage("upload-preview");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't read this file.");
      setStage("upload-pick");
    }
  }

  function updateColumnType(index: number, type: DatasetColumnType) {
    setDetectedSchema((s) => s.map((c, i) => (i === index ? { ...c, type } : c)));
  }

  /** Retries a single chunk up to 3 times with a short, increasing pause
   *  between attempts before actually giving up — for a multi-minute
   *  upload spanning hundreds of sequential requests, treating any single
   *  transient failure (a network blip, a momentary D1 hiccup) as fatal
   *  would make large uploads unreasonably fragile. Only the failing
   *  chunk retries; every chunk that already succeeded stays inserted. */
  async function uploadChunkWithRetry(datasetId: string, chunk: Record<string, unknown>[], attempt = 1): Promise<{ inserted: number }> {
    try {
      return await api.uploadDatasetRows(datasetId, chunk);
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      return uploadChunkWithRetry(datasetId, chunk, attempt + 1);
    }
  }

  async function handleUpload() {
    if (parsedRows.length === 0 || !datasetName.trim()) return;
    setStage("uploading");
    setUploadError(null);
    // Declared here (not inside try) specifically so it's still readable
    // in catch below — progress (the React state) would be stale there,
    // captured at whatever it was when this function started rather than
    // its latest value from inside the loop.
    let done = 0;
    try {
      const dataset = await api.createDataset(datasetName.trim(), detectedSchema);
      const converted: Record<string, unknown>[] = [];
      for (let i = 0; i < parsedRows.length; i++) {
        const raw = parsedRows[i];
        const row: Record<string, unknown> = {};
        for (const col of detectedSchema) row[col.name] = cellToDatasetValue(raw[col.name], col.type);
        converted.push(row);
        await yieldPeriodically(i);
      }

      const CHUNK = 500;
      setProgress({ done: 0, total: converted.length });
      for (let i = 0; i < converted.length; i += CHUNK) {
        const chunk = converted.slice(i, i + CHUNK);
        const result = await uploadChunkWithRetry(dataset.id, chunk);
        done += result.inserted;
        setProgress({ done, total: converted.length });
      }
      setStage("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      // Each chunk that succeeded before this failure is already committed
      // to the dataset — retrying the whole thing from zero isn't
      // necessary, so this says as much rather than implying total loss.
      setUploadError(
        done > 0
          ? `${message} — ${done.toLocaleString()} of ${parsedRows.length.toLocaleString()} rows were already saved before this happened; check the dataset's row count, or delete it and try again if it looks incomplete.`
          : `${message} Nothing was saved yet — safe to try again.`
      );
      setStage("upload-preview");
    }
  }

  function resetUpload() {
    setStage("list");
    setFileName(null);
    setDatasetName("");
    setDetectedSchema([]);
    setParsedRows([]);
    setParseError(null);
    setUploadError(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this dataset and all its rows? This can't be undone.")) return;
    await api.deleteDataset(id);
    loadDatasets();
  }

  if (stage === "list") {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="eyebrow">YOUR DATASETS ({datasets.length})</div>
          <button onClick={() => setStage("upload-pick")} style={primaryBtnStyle}>
            + Upload dataset
          </button>
        </div>
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
        ) : datasets.length === 0 ? (
          <div className="panel" style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
            No datasets yet — upload any spreadsheet (health stats, economic data, anything with rows and columns) and it'll show up here, ready to chart the same way incidents are.
            <br />
            <button onClick={() => setStage("upload-pick")} style={{ ...primaryBtnStyle, marginTop: 12 }}>
              + Upload dataset
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {datasets.map((d) => (
              <div key={d.id} className="panel" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {d.row_count.toLocaleString()} rows · {d.schema.length} columns · uploaded {new Date(d.created_at).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.schema.map((c) => c.name).join(", ")}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setViewingDataset(d);
                    setStage("viewing");
                  }}
                  style={secondaryBtnStyle}
                >
                  View / Edit
                </button>
                <button onClick={() => handleDelete(d.id)} style={dangerBtnStyle}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (stage === "viewing" && viewingDataset) {
    return (
      <DatasetRowsView
        dataset={viewingDataset}
        onBack={() => {
          setViewingDataset(null);
          setStage("list");
        }}
      />
    );
  }

  if (stage === "detecting-schema") {
    return (
      <div style={{ flex: 1, padding: 24 }}>
        <div className="panel" style={{ marginTop: 16, padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
          Reading {fileName}… this can take a moment for a large file, and the tab stays responsive while it works.
        </div>
      </div>
    );
  }

  if (stage === "upload-pick") {
    return (
      <div style={{ flex: 1, padding: 24 }}>
        <button onClick={() => setStage("list")} style={secondaryBtnStyle}>
          ← All datasets
        </button>
        <div className="panel" style={{ marginTop: 16, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Upload any spreadsheet</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16 }}>
            CSV or Excel — column names and types are detected automatically from the first sheet, and you can adjust them before importing.
          </div>
          <label style={{ ...primaryBtnStyle, display: "inline-block", cursor: "pointer" }}>
            Choose file
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
          {parseError && <div style={{ color: "var(--critical)", fontSize: 12.5, marginTop: 12 }}>{parseError}</div>}
        </div>
      </div>
    );
  }

  if (stage === "upload-preview" || stage === "uploading" || stage === "done") {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {stage === "upload-preview" && (
          <button onClick={resetUpload} style={secondaryBtnStyle}>
            ← Cancel
          </button>
        )}
        <div className="panel" style={{ marginTop: 16, padding: 20 }}>
          {stage === "done" ? (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>✓ Uploaded</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
                {progress.total.toLocaleString()} rows imported into "{datasetName}".
              </div>
              <button onClick={resetUpload} style={primaryBtnStyle}>
                Back to datasets
              </button>
            </div>
          ) : stage === "uploading" ? (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 13.5, marginBottom: 10 }}>
                Uploading… {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
              </div>
              <div style={{ height: 6, background: "var(--panel-raised)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    background: "var(--signal)",
                    transition: "width 0.2s",
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>DATASET NAME</div>
                <input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} style={{ ...selectStyle, width: "100%" }} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
                {fileName} · {parsedRows.length.toLocaleString()} rows · confirm each column's type below
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
                {detectedSchema.map((col, idx) => (
                  <div key={col.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "var(--panel-raised)", borderRadius: 6 }}>
                    <div style={{ flex: 1, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.name}</div>
                    <select value={col.type} onChange={(e) => updateColumnType(idx, e.target.value as DatasetColumnType)} style={selectStyle}>
                      <option value="text">Text / category</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                    </select>
                  </div>
                ))}
              </div>
              {parsedRows.length > 100_000 && (
                <div
                  style={{
                    fontSize: 12,
                    color: parsedRows.length > 500_000 ? "var(--critical)" : "#b45309",
                    background: parsedRows.length > 500_000 ? "color-mix(in srgb, var(--critical) 10%, transparent)" : "color-mix(in srgb, #b45309 10%, transparent)",
                    border: `1px solid ${parsedRows.length > 500_000 ? "var(--critical)" : "#b45309"}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    marginTop: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {parsedRows.length > 500_000
                    ? `${parsedRows.length.toLocaleString()} rows is a lot — upload could take 30+ minutes, and this shares storage with every other dataset and this app's own incident data on the same database, which has a hard size limit. If this is summarizable (e.g. yearly totals instead of every individual record), a smaller upload will load faster everywhere it's used.`
                    : `${parsedRows.length.toLocaleString()} rows will take a few minutes to upload. Charts and widgets built on it will still show fast, aggregated summaries — this only affects the one-time import.`}
                </div>
              )}
              {uploadError && <div style={{ color: "var(--critical)", fontSize: 12.5, marginTop: 12 }}>{uploadError}</div>}
              <button onClick={handleUpload} disabled={!datasetName.trim()} style={{ ...primaryBtnStyle, marginTop: 16 }}>
                Import {parsedRows.length.toLocaleString()} rows
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}

/** A row's own data keyed by column name, plus the id/timestamp the backend
 *  wraps it in. */
type RowRecord = { id: string; data: Record<string, unknown>; created_at: string };

/** Paginated view of an existing dataset's actual rows, not just chart
 *  aggregates over them — "open and edit that data" directly, the same way
 *  a spreadsheet would let you. Editing swaps a whole row into inputs at
 *  once (not per-cell) — simpler to reason about correctly than tracking
 *  which of many individual cells is mid-edit at any moment. */
function DatasetRowsView({ dataset, onBack }: { dataset: Dataset; onBack: () => void }) {
  const [rows, setRows] = useState<RowRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const [loading, setLoading] = useState(true);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [addingRow, setAddingRow] = useState(false);
  const [newRowDraft, setNewRowDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getDatasetRows(dataset.id, offset, limit);
      setRows(result.rows);
      setTotal(result.total);
    } catch {
      setError("Couldn't load rows — try again.");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.id, offset]);

  function coerce(value: string, colType: DatasetColumnType): string | number | null {
    if (value === "") return null;
    if (colType === "number") {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }

  function startEdit(row: RowRecord) {
    setEditingRowId(row.id);
    setEditDraft({ ...row.data });
  }

  async function saveEdit() {
    if (!editingRowId) return;
    try {
      await api.updateDatasetRow(dataset.id, editingRowId, editDraft);
      setEditingRowId(null);
      load();
    } catch {
      setError("Couldn't save that edit — try again.");
    }
  }

  async function handleDeleteRow(id: string) {
    if (!window.confirm("Delete this row? This can't be undone.")) return;
    try {
      await api.deleteDatasetRow(dataset.id, id);
      load();
    } catch {
      setError("Couldn't delete that row — try again.");
    }
  }

  async function handleAddRow() {
    try {
      await api.addDatasetRow(dataset.id, newRowDraft);
      setAddingRow(false);
      setNewRowDraft({});
      setOffset(0);
      load();
    } catch {
      setError("Couldn't add that row — try again.");
    }
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + limit, total);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
        <div>
          <button onClick={onBack} style={{ ...secondaryBtnStyle, marginBottom: 8 }}>
            ← All datasets
          </button>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{dataset.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {total.toLocaleString()} row{total === 1 ? "" : "s"} · {dataset.schema.length} columns
          </div>
        </div>
        {!addingRow && (
          <button onClick={() => setAddingRow(true)} style={primaryBtnStyle}>
            + Add row manually
          </button>
        )}
      </div>

      {error && <div style={{ color: "var(--critical)", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}

      {addingRow && (
        <div className="panel" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="eyebrow">NEW ROW</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, dataset.schema.length)}, 1fr)`, gap: 8 }}>
            {dataset.schema.map((col) => (
              <label key={col.name} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
                <span style={{ color: "var(--text-muted)" }}>
                  {col.name} <span style={{ color: "var(--text-faint)" }}>({col.type})</span>
                </span>
                <input
                  type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
                  value={String(newRowDraft[col.name] ?? "")}
                  onChange={(e) => setNewRowDraft((prev) => ({ ...prev, [col.name]: coerce(e.target.value, col.type) }))}
                  style={selectStyle}
                />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAddRow} style={primaryBtnStyle}>
              Save row
            </button>
            <button
              onClick={() => {
                setAddingRow(false);
                setNewRowDraft({});
              }}
              style={secondaryBtnStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="panel" style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
          No rows yet.
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--panel-raised)" }}>
                  {dataset.schema.map((col) => (
                    <th key={col.name} style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                      {col.name}
                    </th>
                  ))}
                  <th style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isEditing = editingRowId === row.id;
                  return (
                    <tr key={row.id} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                      {dataset.schema.map((col) => (
                        <td key={col.name} style={{ padding: "5px 10px" }}>
                          {isEditing ? (
                            <input
                              type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
                              value={String(editDraft[col.name] ?? "")}
                              onChange={(e) => setEditDraft((prev) => ({ ...prev, [col.name]: coerce(e.target.value, col.type) }))}
                              style={{ ...selectStyle, minWidth: 90 }}
                            />
                          ) : (
                            <span>{row.data[col.name] === null || row.data[col.name] === undefined ? "—" : String(row.data[col.name])}</span>
                          )}
                        </td>
                      ))}
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                        {isEditing ? (
                          <>
                            <button onClick={saveEdit} style={{ ...miniActionBtnStyle, color: "var(--signal)" }}>
                              Save
                            </button>
                            <button onClick={() => setEditingRowId(null)} style={miniActionBtnStyle}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(row)} style={miniActionBtnStyle}>
                              Edit
                            </button>
                            <button onClick={() => handleDeleteRow(row.id)} style={{ ...miniActionBtnStyle, color: "var(--critical)" }}>
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
            <span>
              Showing {pageStart}–{pageEnd} of {total.toLocaleString()}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setOffset((o) => Math.max(0, o - limit))} disabled={offset === 0} style={secondaryBtnStyle}>
                ← Previous
              </button>
              <button onClick={() => setOffset((o) => o + limit)} disabled={offset + limit >= total} style={secondaryBtnStyle}>
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  border: "1px solid var(--critical)",
  color: "var(--critical)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12.5,
};

const miniActionBtnStyle: React.CSSProperties = {
  padding: "2px 6px",
  marginRight: 4,
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 11.5,
  textDecoration: "underline",
};

const selectStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text-primary)",
};
