import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { api, type Dataset, type DatasetColumn, type DatasetColumnType } from "../api";

/** Samples up to 50 non-empty values per column and votes on a type — "date"
 *  if most values are real Date objects (from XLSX's cellDates parsing) or
 *  look like a date string, "number" if most parse cleanly as numeric,
 *  "text" otherwise. Deliberately conservative (80% threshold) since a wrong
 *  guess is easy to fix by hand in the preview step, but a column silently
 *  mis-typed as "number" when it's really mixed text would break charts. */
function detectColumnType(values: unknown[]): DatasetColumnType {
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

type Stage = "list" | "upload-pick" | "upload-preview" | "uploading" | "done";

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

  async function loadDatasets() {
    setLoading(true);
    const rows = await api.getDatasets();
    setDatasets(rows);
    setLoading(false);
  }

  useEffect(() => {
    if (stage === "list") loadDatasets();
  }, [stage]);

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

      const headers = Object.keys(rawRows[0]);
      const schema: DatasetColumn[] = headers.map((name) => ({
        name,
        type: detectColumnType(rawRows.map((r) => r[name])),
      }));

      setDetectedSchema(schema);
      setParsedRows(rawRows);
      setStage("upload-preview");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't read this file.");
    }
  }

  function updateColumnType(index: number, type: DatasetColumnType) {
    setDetectedSchema((s) => s.map((c, i) => (i === index ? { ...c, type } : c)));
  }

  async function handleUpload() {
    if (parsedRows.length === 0 || !datasetName.trim()) return;
    setStage("uploading");
    setUploadError(null);
    try {
      const dataset = await api.createDataset(datasetName.trim(), detectedSchema);
      const converted = parsedRows.map((raw) => {
        const row: Record<string, unknown> = {};
        for (const col of detectedSchema) row[col.name] = cellToDatasetValue(raw[col.name], col.type);
        return row;
      });

      const CHUNK = 500;
      let done = 0;
      setProgress({ done: 0, total: converted.length });
      for (let i = 0; i < converted.length; i += CHUNK) {
        const chunk = converted.slice(i, i + CHUNK);
        const result = await api.uploadDatasetRows(dataset.id, chunk);
        done += result.inserted;
        setProgress({ done, total: converted.length });
      }
      setStage("done");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed partway through.");
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

const selectStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text-primary)",
};
