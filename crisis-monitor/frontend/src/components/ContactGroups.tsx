import { useEffect, useState } from "react";
import { api, type Contact, type ContactGroup } from "../api";

const btn: React.CSSProperties = { fontSize: 12.5, padding: "6px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "var(--signal-dim)", border: "1px solid var(--signal)", color: "var(--text-primary)", fontWeight: 600 };
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "7px 9px", background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "inherit" };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: "0.06em", color: "var(--text-faint)", fontWeight: 600, margin: "16px 0 6px" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, letterSpacing: "0.06em", color: "var(--text-faint)", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "7px 8px", fontSize: 12.5, borderBottom: "1px solid var(--border-soft)", verticalAlign: "top" };

const EMPTY = { name: "", organisation: "", email: "", phone: "", notes: "" };

/** Contact groups: named lists of people (not platform users) that an alert or publication can be sent to in one go. */
export default function ContactGroups({ onChanged }: { onChanged: () => void }) {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [active, setActive] = useState<string>(""); // group id, "" = everyone
  const [q, setQ] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  async function loadGroups() {
    setGroups(await api.listContactGroups().catch(() => []));
    onChanged();
  }
  async function loadContacts() {
    setContacts(await api.listContacts({ group_id: active, q }).catch(() => []));
  }
  useEffect(() => {
    loadGroups();
  }, []);
  useEffect(() => {
    const t = setTimeout(loadContacts, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [active, q]);

  const current = groups.find((g) => g.id === active);

  async function createGroup() {
    if (!newGroup.trim()) return;
    setError(null);
    try {
      const g = await api.createContactGroup(newGroup.trim());
      setNewGroup("");
      setActive(g.id);
      await loadGroups();
    } catch (e) {
      fail(e, "Couldn't create the group.");
    }
  }

  async function removeGroup() {
    if (!current || !window.confirm(`Delete the group "${current.name}"? The people in it stay in your contacts.`)) return;
    await api.deleteContactGroup(current.id).catch((e) => fail(e, "Couldn't delete."));
    setActive("");
    await loadGroups();
  }

  async function renameGroup() {
    if (!current) return;
    const name = window.prompt("Group name", current.name);
    if (!name || name.trim() === current.name) return;
    await api.updateContactGroup(current.id, { name: name.trim() }).catch((e) => fail(e, "Couldn't rename."));
    await loadGroups();
  }

  async function saveContact() {
    setError(null);
    setMsg(null);
    try {
      const body = { name: draft.name, organisation: draft.organisation || null, email: draft.email || null, phone: draft.phone || null, notes: draft.notes || null };
      if (editing) await api.updateContact(editing, body);
      else await api.createContact({ ...body, group_ids: active ? [active] : [] } as Partial<Contact>);
      setDraft(EMPTY);
      setEditing(null);
      setAdding(false);
      await Promise.all([loadContacts(), loadGroups()]);
    } catch (e) {
      fail(e, "Couldn't save the contact.");
    }
  }

  async function doImport() {
    setError(null);
    setMsg(null);
    try {
      const r = await api.importContacts(paste, active || null);
      setMsg(`${r.added} added, ${r.reused} already in your contacts${r.rejected_total ? `, ${r.rejected_total} skipped (${r.rejected.slice(0, 3).map((x) => `"${x.line}": ${x.reason}`).join("; ")}${r.rejected_total > 3 ? "…" : ""})` : ""}.`);
      setPaste("");
      await Promise.all([loadContacts(), loadGroups()]);
    } catch (e) {
      fail(e, "Couldn't import.");
    }
  }

  async function toggleMember(c: Contact, groupId: string) {
    const ids = c.group_ids.includes(groupId) ? c.group_ids.filter((x) => x !== groupId) : [...c.group_ids, groupId];
    await api.updateContact(c.id, { group_ids: ids }).catch((e) => fail(e, "Couldn't update."));
    await Promise.all([loadContacts(), loadGroups()]);
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 740, lineHeight: 1.6 }}>
        Keep partners, journalists, embassy staff and a client's wider team in named groups. When you send an alert or publication, tick the group and everyone in it is reached by email, SMS or Signal, wherever you have their details.
      </div>
      {error && <div style={{ color: "var(--critical)", fontSize: 13, margin: "8px 0" }}>{error}</div>}
      {msg && <div style={{ color: "var(--signal)", fontSize: 13, margin: "8px 0" }}>{msg}</div>}

      <div style={label}>GROUPS</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button onClick={() => setActive("")} style={active === "" ? primary : btn}>
          Everyone
        </button>
        {groups.map((g) => (
          <button key={g.id} onClick={() => setActive(g.id)} style={active === g.id ? primary : btn}>
            {g.name} ({g.members})
          </button>
        ))}
        <input placeholder="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createGroup()} style={{ ...field, width: 190 }} />
        <button onClick={createGroup} style={btn}>
          Create group
        </button>
      </div>
      {current && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button onClick={renameGroup} style={btn}>
            Rename
          </button>
          <button onClick={removeGroup} style={{ ...btn, color: "var(--critical)" }}>
            Delete group
          </button>
        </div>
      )}

      <div style={label}>{current ? `PEOPLE IN "${current.name.toUpperCase()}"` : "EVERYONE"}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input placeholder="Search name, email, number, organisation" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...field, width: 300 }} />
        <button
          onClick={() => {
            setAdding(true);
            setEditing(null);
            setDraft(EMPTY);
          }}
          style={primary}
        >
          Add a person
        </button>
        <button onClick={() => setShowImport((v) => !v)} style={btn}>
          Paste a list
        </button>
      </div>

      {showImport && (
        <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 6 }}>
            One person per line: <span className="mono">Name, email, phone, organisation</span>. Email or phone may be left empty. Phone numbers need the country code (+254…). {current ? `They are added to "${current.name}".` : "Choose a group above to add them to it."} People already in your contacts are not duplicated.
          </div>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} style={{ ...field, fontFamily: "ui-monospace, monospace", fontSize: 12 }} placeholder={"Wanjiru Kamau, wanjiru@acme.org, +254712345678, Acme Ltd\nJames Otieno, , +254700111222, Beta Security"} />
          <button onClick={doImport} disabled={paste.trim().length < 3} style={{ ...primary, marginTop: 8 }}>
            Import
          </button>
        </div>
      )}

      {(adding || editing) && (
        <div className="panel" style={{ padding: 14, marginBottom: 10, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={field} />
          <input placeholder="Organisation" value={draft.organisation} onChange={(e) => setDraft({ ...draft, organisation: e.target.value })} style={field} />
          <input placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} style={field} />
          <input placeholder="Phone, e.g. +254712345678" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={field} />
          <input placeholder="Notes (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={{ ...field, gridColumn: "1 / -1" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveContact} disabled={!draft.name.trim()} style={primary}>
              {editing ? "Save" : active ? `Add to "${current?.name}"` : "Add"}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setEditing(null);
                setDraft(EMPTY);
              }}
              style={btn}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>NAME</th>
              <th style={th}>EMAIL</th>
              <th style={th}>PHONE (SMS / SIGNAL)</th>
              <th style={th}>GROUPS</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--text-muted)" }} colSpan={5}>
                  No people here yet. Add a person or paste a list.
                </td>
              </tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  {c.organisation && <div style={{ color: "var(--text-faint)", fontSize: 11 }}>{c.organisation}</div>}
                </td>
                <td style={td}>{c.email ?? "—"}</td>
                <td style={td}>{c.phone ?? "—"}</td>
                <td style={td}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                    {groups.map((g) => (
                      <label key={g.id} style={{ fontSize: 11.5, display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="checkbox" checked={c.group_ids.includes(g.id)} onChange={() => toggleMember(c, g.id)} /> {g.name}
                      </label>
                    ))}
                  </div>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => {
                      setEditing(c.id);
                      setAdding(false);
                      setDraft({ name: c.name, organisation: c.organisation ?? "", email: c.email ?? "", phone: c.phone ?? "", notes: c.notes ?? "" });
                    }}
                    style={btn}
                  >
                    Edit
                  </button>{" "}
                  <button onClick={() => api.updateContact(c.id, { active: !c.active }).then(() => Promise.all([loadContacts(), loadGroups()]))} style={btn} title="Paused people are skipped on every send">
                    {c.active ? "Pause" : "Resume"}
                  </button>{" "}
                  <button
                    onClick={() => window.confirm(`Remove ${c.name} from your contacts?`) && api.deleteContact(c.id).then(() => Promise.all([loadContacts(), loadGroups()]))}
                    style={{ ...btn, color: "var(--critical)" }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
