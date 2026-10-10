import { useEffect, useMemo, useState } from "react";
import { api, type SourceRegisterEntry } from "../api";

const REGION_ORDER = ["Pan-African", "North Africa", "West Africa", "Central Africa", "East Africa", "Southern Africa", "Middle East", "International", "Institutions", "Data providers"];

const field: React.CSSProperties = { background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "7px 10px", fontSize: 13, fontFamily: "var(--font-body)" };
const btn: React.CSSProperties = { fontSize: 12.5, padding: "6px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "var(--signal-dim)", border: "1px solid var(--signal)", color: "var(--text-primary)", fontWeight: 600 };

const EMPTY = { name: "", url: "", country: "", kind: "local_media", role: "pulled" as "pulled" | "reference", notes: "" };

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Super-admin page: every outlet and body behind the platform's reporting, by region and country, with links. */
export default function SourcesRegister({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<SourceRegisterEntry[]>([]);
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [role, setRole] = useState<"" | "pulled" | "reference">("");
  const [presenting, setPresenting] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  async function load() {
    try {
      const r = await api.getSourceRegister();
      setEntries(r.entries);
      setKinds(r.kinds);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the register.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (presenting && !e.active) return false;
      if (region && e.region !== region) return false;
      if (role && e.role !== role) return false;
      return !needle || `${e.name} ${e.url} ${e.country_name} ${e.notes ?? ""}`.toLowerCase().includes(needle);
    });
  }, [entries, q, region, role, presenting]);

  const grouped = useMemo(() => {
    const byRegion = new Map<string, Map<string, SourceRegisterEntry[]>>();
    for (const e of visible) {
      if (!byRegion.has(e.region)) byRegion.set(e.region, new Map());
      const c = byRegion.get(e.region)!;
      if (!c.has(e.country_name)) c.set(e.country_name, []);
      c.get(e.country_name)!.push(e);
    }
    return [...byRegion.entries()].sort((a, b) => (REGION_ORDER.indexOf(a[0]) + 1 || 99) - (REGION_ORDER.indexOf(b[0]) + 1 || 99));
  }, [visible]);

  const pulled = entries.filter((e) => e.role === "pulled").length;

  function download() {
    const rows = [["Region", "Country", "Source", "Type", "How we use it", "Link", "Notes"], ...visible.map((e) => [e.region, e.country_name, e.name, kinds[e.kind] ?? e.kind, e.role === "pulled" ? "Feeds the platform" : "Verification reference", e.url, e.notes ?? ""])];
    const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `afrilens_sources_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function save() {
    setError(null);
    try {
      const body = { name: draft.name, url: draft.url, country: draft.country, kind: draft.kind, role: draft.role, notes: draft.notes || null };
      if (editing === "new") await api.addSource(body as never);
      else if (editing) await api.updateSource(editing, body as never);
      setEditing(null);
      setDraft(EMPTY);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  async function remove(e: SourceRegisterEntry) {
    if (!window.confirm(`Remove "${e.name}" from the register?`)) return;
    await api.deleteSource(e.id).catch((err) => setError(err instanceof Error ? err.message : "Couldn't remove."));
    await load();
  }

  async function toggleActive(e: SourceRegisterEntry) {
    await api.updateSource(e.id, { active: !e.active }).catch(() => {});
    await load();
  }

  async function restore() {
    const r = await api.restoreSourceDefaults().catch(() => null);
    setError(r ? (r.added ? `Added ${r.added} missing standard source${r.added === 1 ? "" : "s"}.` : "Nothing was missing.") : "Couldn't restore.");
    await load();
  }

  const form = (
    <div className="panel" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8, maxWidth: 560 }}>
      <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={field} />
      <input placeholder="Link, e.g. https://www.example.org/" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} style={field} />
      <input placeholder="Country code (KE, NG…) or PAN, INT, INST, DATA" value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} style={field} />
      <div style={{ display: "flex", gap: 8 }}>
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={{ ...field, flex: 1 }}>
          {Object.entries(kinds).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as "pulled" | "reference" })} style={{ ...field, flex: 1 }}>
          <option value="pulled">Feeds the platform</option>
          <option value="reference">Verification reference</option>
        </select>
      </div>
      <input placeholder="Notes (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={field} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} style={primary}>
          Save
        </button>
        <button
          onClick={() => {
            setEditing(null);
            setDraft(EMPTY);
          }}
          style={btn}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }} className="sources-register">
      <style>{`@media print { .sr-noprint { display: none !important; } .sources-register { overflow: visible !important; } }`}</style>
      <div className="sr-noprint" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button onClick={onBack} style={btn}>
          ← Admin
        </button>
        <button onClick={() => setPresenting((v) => !v)} style={presenting ? primary : btn} title="Hides the editing controls and anything switched off, for showing a client">
          {presenting ? "Client view: on" : "Client view"}
        </button>
        <button onClick={download} style={btn}>
          Download CSV
        </button>
        <button onClick={() => window.print()} style={btn}>
          Print / save as PDF
        </button>
      </div>

      <div style={{ fontSize: 20, fontWeight: 700 }}>Afrilens Consulting: our sources</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 14px", maxWidth: 760, lineHeight: 1.55 }}>
        Our reporting draws on {pulled} local, regional and international outlets, agencies, institutions and data providers across Africa and the Middle East. Sources marked <b>Feeds the platform</b> are monitored for reporting (where an outlet publishes a feed we can read); sources marked <b>Verification reference</b> are credible bodies we use to check and cross-reference what we find. Where a source is state-owned or state-aligned we say so.
      </div>

      <div className="sr-noprint" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input placeholder="Search sources, countries…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...field, minWidth: 240 }} />
        <select value={region} onChange={(e) => setRegion(e.target.value)} style={field}>
          <option value="">All regions</option>
          {REGION_ORDER.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as "" | "pulled" | "reference")} style={field}>
          <option value="">All sources</option>
          <option value="pulled">Feeds the platform</option>
          <option value="reference">Verification reference</option>
        </select>
        {!presenting && (
          <>
            <button
              onClick={() => {
                setEditing("new");
                setDraft(EMPTY);
              }}
              style={primary}
            >
              + Add source
            </button>
            <button onClick={restore} style={btn} title="Adds any standard source that is missing. Never changes or removes yours.">
              Add missing standard sources
            </button>
          </>
        )}
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--critical)", marginBottom: 10 }}>{error}</div>}
      {editing && !presenting && form}
      {loading && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}
      {!loading && visible.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No sources match.</div>}

      {grouped.map(([reg, countries]) => (
        <div key={reg} style={{ marginBottom: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 8, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>
            {reg.toUpperCase()}
          </div>
          {[...countries.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([country, list]) => (
            <div key={country} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, margin: "6px 0 4px" }}>
                {country} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({list.length})</span>
              </div>
              {list.map((e) => (
                <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0", fontSize: 13, opacity: e.active ? 1 : 0.5, flexWrap: "wrap" }}>
                  <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--signal)", fontWeight: 600, textDecoration: "none" }}>
                    {e.name}
                  </a>
                  <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>{kinds[e.kind] ?? e.kind}</span>
                  <span style={{ fontSize: 10.5, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--border)", color: e.role === "pulled" ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {e.role === "pulled" ? "FEEDS THE PLATFORM" : "VERIFICATION REFERENCE"}
                  </span>
                  {e.notes && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{e.notes}</span>}
                  <span className="mono sr-print-url" style={{ color: "var(--text-faint)", fontSize: 11 }}>
                    {e.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  </span>
                  {!presenting && (
                    <span className="sr-noprint" style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button
                        onClick={() => {
                          setEditing(e.id);
                          setDraft({ name: e.name, url: e.url, country: e.country, kind: e.kind, role: e.role, notes: e.notes ?? "" });
                        }}
                        style={btn}
                      >
                        Edit
                      </button>
                      <button onClick={() => toggleActive(e)} style={btn} title="Switched-off sources stay here but are hidden in Client view">
                        {e.active ? "Hide in client view" : "Show"}
                      </button>
                      <button onClick={() => remove(e)} style={{ ...btn, color: "var(--critical)" }}>
                        Remove
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
