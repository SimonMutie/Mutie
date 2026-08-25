import { useState } from "react";
import { api, type IncidentItem, type IncidentRow } from "../api";

interface Props {
  onSaved: () => void;
  /** Edit an existing incident instead of creating a new one. */
  existingIncident?: IncidentItem;
  onCancel?: () => void;
}

const NUMERIC_KEYS = [
  "civilian_death_child",
  "civilian_death_female",
  "civilian_death_male",
  "civilian_death_unknown",
  "civilian_injury_female",
  "civilian_injury_male",
  "civilian_injury_unknown",
  "kidnappings_ngo",
] as const;

const EMPTY_FORM: IncidentRow = {
  date: "",
  time: "",
  country: "",
  province: "",
  county: "",
  district: "",
  city: "",
  suburb: "",
  precise_location: "",
  latitude: null,
  longitude: null,
  sector: "",
  actor: "",
  operation: "",
  tactic: "",
  severity: "",
  details: "",
  target: "",
  interest_group: "",
  actual_main_victim: "",
  intended_primary_target: "",
  civilian_death_child: null,
  civilian_death_female: null,
  civilian_death_male: null,
  civilian_death_unknown: null,
  civilian_injury_female: null,
  civilian_injury_male: null,
  civilian_injury_unknown: null,
  kidnappings_ngo: null,
};

/** IncidentItem (what the API returns) uses occurred_date/occurred_time as its
 *  column names, while IncidentRow (what forms/uploads use) uses date/time —
 *  see the note on this mismatch in api.ts. Converts one to the other so the
 *  edit form can be pre-filled from a real incident record. */
function incidentToFormValues(incident: IncidentItem): IncidentRow {
  return {
    date: incident.occurred_date ?? "",
    time: incident.occurred_time ?? "",
    country: incident.country ?? "",
    province: incident.province ?? "",
    county: incident.county ?? "",
    district: incident.district ?? "",
    city: incident.city ?? "",
    suburb: incident.suburb ?? "",
    precise_location: incident.precise_location ?? "",
    latitude: incident.latitude ?? null,
    longitude: incident.longitude ?? null,
    sector: incident.sector ?? "",
    actor: incident.actor ?? "",
    operation: incident.operation ?? "",
    tactic: incident.tactic ?? "",
    severity: incident.severity ?? "",
    details: incident.details ?? "",
    target: incident.target ?? "",
    interest_group: incident.interest_group ?? "",
    actual_main_victim: incident.actual_main_victim ?? "",
    intended_primary_target: incident.intended_primary_target ?? "",
    civilian_death_child: incident.civilian_death_child ?? null,
    civilian_death_female: incident.civilian_death_female ?? null,
    civilian_death_male: incident.civilian_death_male ?? null,
    civilian_death_unknown: incident.civilian_death_unknown ?? null,
    civilian_injury_female: incident.civilian_injury_female ?? null,
    civilian_injury_male: incident.civilian_injury_male ?? null,
    civilian_injury_unknown: incident.civilian_injury_unknown ?? null,
    kidnappings_ngo: incident.kidnappings_ngo ?? null,
  };
}

type Stage = "idle" | "saving" | "error";

export default function IncidentManualEntry({ onSaved, existingIncident, onCancel }: Props) {
  const isEdit = !!existingIncident;
  const [form, setForm] = useState<IncidentRow>(existingIncident ? incidentToFormValues(existingIncident) : EMPTY_FORM);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  function setField<K extends keyof IncidentRow>(key: K, value: IncidentRow[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function textField(key: keyof IncidentRow, label: string, placeholder?: string) {
    return (
      <div>
        <label style={labelStyle}>{label}</label>
        <input
          value={(form[key] as string) ?? ""}
          onChange={(e) => setField(key, e.target.value as never)}
          placeholder={placeholder}
          style={inputStyle}
        />
      </div>
    );
  }

  function numberField(key: keyof IncidentRow, label: string) {
    return (
      <div>
        <label style={labelStyle}>{label}</label>
        <input
          type="number"
          value={form[key] === null || form[key] === undefined ? "" : String(form[key])}
          onChange={(e) => setField(key, (e.target.value === "" ? null : Number(e.target.value)) as never)}
          style={inputStyle}
        />
      </div>
    );
  }

  function textAreaField(key: keyof IncidentRow, label: string, placeholder?: string) {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>{label}</label>
        <textarea
          value={(form[key] as string) ?? ""}
          onChange={(e) => setField(key, e.target.value as never)}
          placeholder={placeholder}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStage("saving");
    setError(null);
    try {
      if (isEdit && existingIncident) {
        await api.updateIncident(existingIncident.id, form);
        setStage("idle");
        onSaved();
        return;
      }
      // Everything in the form is already a plain, JSON-serializable value that
      // matches the same row shape the Excel upload uses, so this reuses the
      // exact same bulk endpoint and validation — one incident, one-row array.
      const result = await api.uploadIncidentsBulk([{ ...form, raw: form as Record<string, unknown> }], "Manual entry");
      setSavedCount((c) => c + result.inserted);
      setForm(EMPTY_FORM);
      setStage("idle");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this incident");
      setStage("error");
    }
  }

  const totalCasualties = NUMERIC_KEYS.reduce((sum, k) => sum + (Number(form[k]) || 0), 0);

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 24 }}>
      {!isEdit && savedCount > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--signal)", background: "color-mix(in srgb, var(--signal) 10%, transparent)", padding: "8px 12px", borderRadius: 6 }}>
          {savedCount} incident{savedCount === 1 ? "" : "s"} added this session.
        </div>
      )}

      <Section title="When & where">
        <div style={gridStyle}>
          {textField("date", "Date", "YYYY-MM-DD")}
          {textField("time", "Time", "HH:MM")}
          {textField("country", "Country")}
          {textField("province", "Province")}
          {textField("county", "County")}
          {textField("district", "District")}
          {textField("city", "City")}
          {textField("suburb", "Suburb")}
          {textField("precise_location", "Precise location")}
          {numberField("latitude", "Latitude")}
          {numberField("longitude", "Longitude")}
        </div>
      </Section>

      <Section title="Classification">
        <div style={gridStyle}>
          {textField("sector", "Sector")}
          {textField("actor", "Actor")}
          {textField("operation", "Operation")}
          {textField("tactic", "Tactic")}
          {textField("severity", "Severity")}
        </div>
      </Section>

      <Section title="Narrative & target">
        <div style={gridStyle}>
          {textField("target", "Target")}
          {textField("interest_group", "Interest group")}
          {textField("actual_main_victim", "Actual main victim")}
          {textField("intended_primary_target", "Intended primary target")}
          {textAreaField("details", "Details", "What happened…")}
        </div>
      </Section>

      <Section title="Casualties">
        <div style={gridStyle}>
          {numberField("civilian_death_child", "Civilian death — child")}
          {numberField("civilian_death_female", "Civilian death — female")}
          {numberField("civilian_death_male", "Civilian death — male")}
          {numberField("civilian_death_unknown", "Civilian death — unknown")}
          {numberField("civilian_injury_female", "Civilian injury — female")}
          {numberField("civilian_injury_male", "Civilian injury — male")}
          {numberField("civilian_injury_unknown", "Civilian injury — unknown")}
          {numberField("kidnappings_ngo", "Kidnappings — NGO")}
        </div>
        {totalCasualties > 0 && (
          <div style={{ fontSize: 12, color: "var(--critical)", marginTop: 8 }}>{totalCasualties} total casualties in this incident</div>
        )}
      </Section>

      {error && (
        <div style={{ fontSize: 12.5, color: "var(--critical)", background: "color-mix(in srgb, var(--critical) 8%, transparent)", padding: "8px 10px", borderRadius: 6 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={stage === "saving"} style={primaryBtnStyle}>
          {stage === "saving" ? "Saving…" : isEdit ? "Save changes" : "Add incident"}
        </button>
        {isEdit ? (
          <button type="button" onClick={onCancel} style={secondaryBtnStyle}>
            Cancel
          </button>
        ) : (
          <button type="button" onClick={() => setForm(EMPTY_FORM)} style={secondaryBtnStyle}>
            Clear form
          </button>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13.5,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13.5,
};
