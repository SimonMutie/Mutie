import { useEffect, useState } from "react";
import { api, type ClientOrg, type AuthUser } from "../api";

interface Props {
  user: AuthUser;
  onBack: () => void;
}

type View = "list" | { clientId: string };

export default function AdminPanel({ user, onBack }: Props) {
  const isPlatformAdmin = user.role === "admin";

  // A client-admin manages only their own team, not the platform-wide list
  // of every client — that view (and the /api/clients list endpoint behind
  // it) is platform-admin only. Landing them directly on their own client's
  // detail view, with the "delete this client" / "change its limits"
  // controls hidden there (see ClientDetail below), keeps this reachable
  // for them at all without exposing platform-level decisions that should
  // stay with whoever's actually running GlobaLens for every client, not
  // any one client's own team lead.
  if (!isPlatformAdmin && user.client_id) {
    return <ClientDetail clientId={user.client_id} isPlatformAdmin={false} onBack={onBack} onClientChanged={() => {}} />;
  }

  return <PlatformAdminView onBack={onBack} />;
}

function PlatformAdminView({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>("list");
  const [clients, setClients] = useState<ClientOrg[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadClients() {
    setLoading(true);
    setClients(await api.listClients());
    setLoading(false);
  }

  useEffect(() => {
    if (view === "list") loadClients();
  }, [view]);

  if (view !== "list") {
    return <ClientDetail clientId={view.clientId} isPlatformAdmin onBack={() => setView("list")} onClientChanged={loadClients} />;
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <button onClick={onBack} style={backBtnStyle}>
        ← All queries
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0" }}>
        <div className="eyebrow">CLIENTS ({clients.length})</div>
      </div>

      <NewClientForm onCreated={loadClients} />

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 16 }}>Loading…</div>
      ) : clients.length === 0 ? (
        <div className="panel" style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5, marginTop: 16 }}>
          No clients yet — create one above to give an organization its own logins, each with its own permissions.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
          {clients.map((c) => (
            <div
              key={c.id}
              onClick={() => setView({ clientId: c.id })}
              className="panel"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {c.account_count} of {c.max_accounts} account{c.max_accounts === 1 ? "" : "s"} used
                </div>
              </div>
              {c.account_count >= c.max_accounts && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase" }}>At limit</span>
              )}
              <span style={{ color: "var(--text-faint)", fontSize: 16 }}>→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewClientForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [maxAccounts, setMaxAccounts] = useState(3);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setMaxAccounts(3);
    setUsername("");
    setPassword("");
    setDisplayName("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Client name is required.");
    if (username.trim().length < 3 || password.length < 8) {
      return setError("Username needs 3+ characters and password needs 8+ characters.");
    }
    setSubmitting(true);
    try {
      await api.createClient({
        name: name.trim(),
        max_accounts: maxAccounts,
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
      });
      reset();
      setOpen(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={primaryBtnStyle}>
        + New client
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8, maxWidth: 400 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>
        NEW CLIENT
      </div>
      <input placeholder="Client name (e.g. Acme Corp)" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
        Max accounts
        <input
          type="number"
          min={1}
          max={50}
          value={maxAccounts}
          onChange={(e) => setMaxAccounts(Math.max(1, Number(e.target.value) || 1))}
          style={{ ...inputStyle, width: 70 }}
        />
      </label>
      <div className="eyebrow" style={{ marginTop: 6, marginBottom: -2 }}>
        FIRST LOGIN (WILL MANAGE THIS CLIENT'S OWN TEAM)
      </div>
      <input placeholder="Display name (optional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
      <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} />
      <input placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
      {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="submit" disabled={submitting} style={primaryBtnStyle}>
          {submitting ? "Creating…" : "Create client"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          style={backBtnStyle}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ClientDetail({
  clientId,
  isPlatformAdmin,
  onBack,
  onClientChanged,
}: {
  clientId: string;
  isPlatformAdmin: boolean;
  onBack: () => void;
  onClientChanged: () => void;
}) {
  const [client, setClient] = useState<ClientOrg | null>(null);
  const [accounts, setAccounts] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingLimits, setEditingLimits] = useState(false);

  async function load() {
    setLoading(true);
    const [c, accts] = await Promise.all([api.getClient(clientId), api.listClientAccounts(clientId)]);
    setClient(c);
    setAccounts(accts);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleToggleAdmin(userId: string, current: boolean) {
    setError(null);
    try {
      await api.updateClientAccount(clientId, userId, { is_client_admin: !current });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that account.");
    }
  }

  async function handleRemoveAccount(userId: string, label: string) {
    if (!window.confirm(`Remove "${label}"'s login? This can't be undone.`)) return;
    setError(null);
    try {
      await api.deleteClientAccount(clientId, userId);
      await load();
      onClientChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that account.");
    }
  }

  async function handleDeleteClient() {
    if (!client) return;
    if (!window.confirm(`Delete "${client.name}" entirely? This removes all ${client.account_count} of its accounts too — can't be undone.`)) return;
    await api.deleteClient(clientId);
    onClientChanged();
    onBack();
  }

  if (loading || !client) {
    return (
      <div style={{ flex: 1, padding: 24 }}>
        <button onClick={onBack} style={backBtnStyle}>
          {isPlatformAdmin ? "← All clients" : "← Back"}
        </button>
        <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 16 }}>{loading ? "Loading…" : "Client not found."}</div>
      </div>
    );
  }

  const atLimit = accounts.length >= client.max_accounts;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <button onClick={onBack} style={backBtnStyle}>
        {isPlatformAdmin ? "← All clients" : "← Back"}
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{client.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {accounts.length} of {client.max_accounts} account{client.max_accounts === 1 ? "" : "s"} used
          </div>
        </div>
        {isPlatformAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEditingLimits((v) => !v)} style={backBtnStyle}>
              {editingLimits ? "Done" : "Edit"}
            </button>
            <button onClick={handleDeleteClient} style={dangerBtnStyle}>
              Delete client
            </button>
          </div>
        )}
      </div>

      {isPlatformAdmin && editingLimits && <EditClientLimits client={client} onSaved={load} onClose={() => setEditingLimits(false)} />}

      {error && (
        <div style={{ fontSize: 13, color: "var(--critical)", background: "color-mix(in srgb, var(--critical) 8%, transparent)", padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="eyebrow" style={{ marginBottom: 10 }}>
        TEAM
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {accounts.map((u) => (
          <div key={u.id} className="panel" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.display_name || u.username}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {u.username}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={u.is_client_admin} onChange={() => handleToggleAdmin(u.id, u.is_client_admin)} />
              Can manage team
            </label>
            <button onClick={() => handleRemoveAccount(u.id, u.display_name || u.username)} style={dangerBtnStyle}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {showAddAccount ? (
          <NewAccountForm
            clientId={clientId}
            onCreated={async () => {
              setShowAddAccount(false);
              await load();
              onClientChanged();
            }}
            onCancel={() => setShowAddAccount(false)}
          />
        ) : (
          <button onClick={() => setShowAddAccount(true)} disabled={atLimit} title={atLimit ? "This client is at its account limit — raise it with Edit, above, to add more." : undefined} style={primaryBtnStyle}>
            + Add account{atLimit ? " (at limit)" : ""}
          </button>
        )}
      </div>
    </div>
  );
}

function EditClientLimits({ client, onSaved, onClose }: { client: ClientOrg; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(client.name);
  const [maxAccounts, setMaxAccounts] = useState(client.max_accounts);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await api.updateClient(client.id, { name: name.trim() || client.name, max_accounts: maxAccounts });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save those changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ padding: "14px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        Max accounts
        <input type="number" min={1} max={50} value={maxAccounts} onChange={(e) => setMaxAccounts(Math.max(1, Number(e.target.value) || 1))} style={{ ...inputStyle, width: 70 }} />
      </label>
      <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function NewAccountForm({ clientId, onCreated, onCancel }: { clientId: string; onCreated: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (username.trim().length < 3 || password.length < 8) {
      return setError("Username needs 3+ characters and password needs 8+ characters.");
    }
    setSubmitting(true);
    try {
      await api.createClientAccount(clientId, { username: username.trim(), password, display_name: displayName.trim() || undefined });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add that account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
      <input placeholder="Display name (optional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
      <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} />
      <input placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
      {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={submitting} style={primaryBtnStyle}>
          {submitting ? "Adding…" : "Add account"}
        </button>
        <button type="button" onClick={onCancel} style={backBtnStyle}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};

const backBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 10px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
};

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

const dangerBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 10px",
  background: "transparent",
  border: "1px solid var(--critical)",
  color: "var(--critical)",
  borderRadius: 6,
  cursor: "pointer",
};
