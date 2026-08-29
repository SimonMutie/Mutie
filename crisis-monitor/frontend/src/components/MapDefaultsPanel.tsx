import { useEffect, useState } from "react";
import { api, type MapDefaultSettings } from "../api";
import { BASEMAPS, type BasemapKey } from "./mapConstants";

/** Platform-admin only (enforced both here via the parent tab's own gating,
 *  and server-side on the PATCH endpoint) — a single, platform-wide default
 *  for what the Mapping view starts with. Not a personal preference: this
 *  is what every client's own Mapping view also starts with, until they
 *  change something within their own session. */
export default function MapDefaultsPanel({ compact }: { compact?: boolean } = {}) {
  const [settings, setSettings] = useState<MapDefaultSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getMapSettings()
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  async function save(patch: Partial<Pick<MapDefaultSettings, "show_incidents_by_default" | "default_view_mode" | "default_basemap">>) {
    if (!settings) return;
    setError(null);
    setSaving(true);
    // Applies immediately to local state so the UI reflects the choice
    // right away, then persists — if the save fails, the fetched-fresh
    // value on next load is still correct even though this optimistic
    // update wouldn't roll back on its own.
    setSettings({ ...settings, ...patch });
    try {
      const updated = await api.updateMapSettings(patch);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that setting.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;
  }
  if (!settings) {
    return <div style={{ color: "var(--critical)", fontSize: 13 }}>Couldn't load map settings.</div>;
  }

  return (
    <div style={compact ? undefined : { maxWidth: 480 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>
        MAP DEFAULTS
      </div>
      <div style={{ fontSize: compact ? 11 : 12.5, color: "var(--text-muted)", marginBottom: compact ? 12 : 20 }}>
        {compact
          ? "The starting point for every Mapping view — yours and every client's."
          : "What every Mapping view — yours and every client's — starts with when first opened. Anyone can still change what they see within their own session; this only controls the starting point."}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "var(--critical)", background: "color-mix(in srgb, var(--critical) 8%, transparent)", padding: "10px 12px", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={settings.show_incidents_by_default}
            onChange={(e) => save({ show_incidents_by_default: e.target.checked })}
            disabled={saving}
            style={{ marginTop: 2 }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Show incidents by default</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              When off, Mapping opens with nothing plotted — incidents only appear once someone turns them on for that session.
            </div>
          </div>
        </label>

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Default view mode</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["markers", "heatmap"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => save({ default_view_mode: mode })}
                disabled={saving}
                style={chipStyle(settings.default_view_mode === mode)}
              >
                {mode === "markers" ? "Icons" : "Heatmap"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Default basemap</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
              <button key={k} onClick={() => save({ default_basemap: k })} disabled={saving} style={chipStyle(settings.default_basemap === k)}>
                {BASEMAPS[k].label}
              </button>
            ))}
          </div>
        </div>

        {saved && <div style={{ fontSize: 12, color: "var(--signal)" }}>Saved.</div>}
      </div>
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
    background: active ? "var(--signal-dim)" : "var(--panel)",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
  };
}
