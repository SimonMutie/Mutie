import { useState } from "react";
import * as XLSX from "xlsx";
import { api, type IncidentRow } from "../api";

interface Props {
  onUploaded: () => void;
}

// Maps every expected spreadsheet column to its canonical backend field name.
// Keys here are already normalized (see normalizeHeader) so matching is
// tolerant of case, extra spaces, and "-" vs " " in the source header.
const HEADER_MAP: Record<string, keyof IncidentRow> = {
  date: "date",
  time: "time",
  country: "country",
  province: "province",
  county: "county",
  district: "district",
  city: "city",
  suburb: "suburb",
  "precise location": "precise_location",
  latitude: "latitude",
  longitude: "longitude",
  sector: "sector",
  actor: "actor",
  operation: "operation",
  tactic: "tactic",
  severity: "severity",
  details: "details",
  target: "target",
  "interest group": "interest_group",
  "actual main victim": "actual_main_victim",
  "civilian death child": "civilian_death_child",
  "civilian death female": "civilian_death_female",
  "civilian death male": "civilian_death_male",
  "civilian death unknown": "civilian_death_unknown",
  "civilian injury female": "civilian_injury_female",
  "civilian injury male": "civilian_injury_male",
  "civilian injury unknown": "civilian_injury_unknown",
  "intended primary target": "intended_primary_target",
  "kidnappings ngo": "kidnappings_ngo",
};

const NUMERIC_FIELDS = new Set<keyof IncidentRow>([
  "latitude",
  "longitude",
  "civilian_death_child",
  "civilian_death_female",
  "civilian_death_male",
  "civilian_death_unknown",
  "civilian_injury_female",
  "civilian_injury_male",
  "civilian_injury_unknown",
  "kidnappings_ngo",
]);

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellToText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10); // YYYY-MM-DD
  return String(value).trim() || null;
}

function cellToNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

interface ParsedResult {
  rows: IncidentRow[];
  unmatchedHeaders: string[];
  missingLatLng: number;
  missingDate: number;
}

function parseSheet(rawRows: Record<string, unknown>[]): ParsedResult {
  const unmatchedHeaders = new Set<string>();
  const rows: IncidentRow[] = [];
  let missingLatLng = 0;
  let missingDate = 0;

  for (const rawRow of rawRows) {
    const isBlank = Object.values(rawRow).every((v) => v === null || v === undefined || v === "");
    if (isBlank) continue;

    const row: IncidentRow = { raw: rawRow };
    for (const [header, value] of Object.entries(rawRow)) {
      const canonical = HEADER_MAP[normalizeHeader(header)];
      if (!canonical) {
        if (normalizeHeader(header)) unmatchedHeaders.add(header);
        continue;
      }
      (row as Record<string, unknown>)[canonical] = NUMERIC_FIELDS.has(canonical) ? cellToNumber(value) : cellToText(value);
    }

    if (row.latitude == null || row.longitude == null) missingLatLng++;
    if (!row.date) missingDate++;
    rows.push(row);
  }

  return { rows, unmatchedHeaders: [...unmatchedHeaders], missingLatLng, missingDate };
}

type Stage = "idle" | "parsed" | "uploading" | "done" | "error";

export default function IncidentUpload({ onUploaded }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [insertedCount, setInsertedCount] = useState(0);

  async function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error("This file doesn't have any sheets.");
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (rawRows.length === 0) throw new Error("No rows found in the first sheet.");

      const result = parseSheet(rawRows);
      if (result.rows.length === 0) throw new Error("Every row was blank after parsing.");
      setParsed(result);
      setStage("parsed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read this file.");
      setStage("error");
    }
  }

  async function handleUpload() {
    if (!parsed) return;
    setStage("uploading");
    setError(null);
    const CHUNK = 500;
    let done = 0;
    setProgress({ done: 0, total: parsed.rows.length });
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const chunk = parsed.rows.slice(i, i + CHUNK);
        const result = await api.uploadIncidentsBulk(chunk, fileName ?? undefined);
        done += result.inserted;
        setProgress({ done, total: parsed.rows.length });
      }
      setInsertedCount(done);
      setStage("done");
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed partway through.");
      setStage("error");
    }
  }

  function reset() {
    setStage("idle");
    setParsed(null);
    setFileName(null);
    setError(null);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {stage === "idle" && (
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "40px 24px",
            border: "1.5px dashed var(--border)",
            borderRadius: 10,
            cursor: "pointer",
            background: "var(--panel)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Click to choose an Excel file</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>.xlsx or .xls — first sheet is used</div>
          <input
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </label>
      )}

      {stage === "error" && (
        <div>
          <div style={{ fontSize: 13, color: "var(--critical)", background: "color-mix(in srgb, var(--critical) 8%, transparent)", padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>
            {error}
          </div>
          <button onClick={reset} style={secondaryBtnStyle}>
            Try another file
          </button>
        </div>
      )}

      {stage === "parsed" && parsed && (
        <div className="panel" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{fileName}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
            {parsed.rows.length.toLocaleString()} row{parsed.rows.length === 1 ? "" : "s"} ready to upload
          </div>

          {parsed.missingLatLng > 0 && (
            <div style={warningStyle}>
              {parsed.missingLatLng} row{parsed.missingLatLng === 1 ? "" : "s"} missing latitude/longitude — they'll still be stored, but won't appear on the map.
            </div>
          )}
          {parsed.missingDate > 0 && (
            <div style={warningStyle}>
              {parsed.missingDate} row{parsed.missingDate === 1 ? "" : "s"} missing a date — they'll be excluded from time-series charts.
            </div>
          )}
          {parsed.unmatchedHeaders.length > 0 && (
            <div style={warningStyle}>
              Column{parsed.unmatchedHeaders.length === 1 ? "" : "s"} not recognized (stored as-is, but not charted): {parsed.unmatchedHeaders.join(", ")}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={handleUpload} style={primaryBtnStyle}>
              Upload {parsed.rows.length.toLocaleString()} incidents
            </button>
            <button onClick={reset} style={secondaryBtnStyle}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "uploading" && (
        <div className="panel" style={{ padding: 20 }}>
          <div style={{ fontSize: 13.5, marginBottom: 8 }}>
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
      )}

      {stage === "done" && (
        <div className="panel" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--signal)", marginBottom: 4 }}>Upload complete</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            {insertedCount.toLocaleString()} incidents added. They're now on the map and in the dashboard.
          </div>
          <button onClick={reset} style={secondaryBtnStyle}>
            Upload another file
          </button>
        </div>
      )}
    </div>
  );
}

const warningStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--elevated)",
  background: "color-mix(in srgb, var(--elevated) 8%, transparent)",
  padding: "8px 10px",
  borderRadius: 6,
  marginBottom: 6,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13.5,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13.5,
};
