import { useEffect, useRef, useState } from "react";
import { api, type AccessRequest, type ClientOrg, type ClientSharedItem, type AuthUser } from "../api";

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
  // stay with whoever's actually running The Lens for every client, not
  // any one client's own team lead.
  if (!isPlatformAdmin && user.client_id) {
    return <ClientDetail clientId={user.client_id} isPlatformAdmin={false} onBack={onBack} onClientChanged={() => {}} />;
  }

  return <PlatformAdminView onBack={onBack} />;
}

function PlatformAdminView({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>("list");
  // The access request being answered by a new account, if any. Its form is pre-filled from the request.
  const [fromRequest, setFromRequest] = useState<AccessRequest | null>(null);
  const [requestsKey, setRequestsKey] = useState(0);
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

      <AccessRequestsSection
        key={requestsKey}
        onCreateAccount={(r) => setFromRequest(r)}
        onDeny={() => setRequestsKey((k) => k + 1)}
      />

      <ActivityLogSection />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0" }}>
        <div className="eyebrow">CLIENTS ({clients.length})</div>
      </div>

      <NewClientForm
        onCreated={loadClients}
        fromRequest={fromRequest}
        onFinished={() => {
          setFromRequest(null);
          setRequestsKey((k) => k + 1);
        }}
      />

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
              {c.paused && <span style={pausedBadgeStyle}>Paused</span>}
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

/** The review queue for requests submitted from the sign-in screen's
 *  "Request Access" tab. Deliberately doesn't create an account when
 *  approved/denied — those actions here are just marking the request
 *  reviewed; the actual login still gets created through NewClientForm
 *  below (or the client-detail team management), since this request only
 *  carries a name/email/reason, not the username/password/client
 *  assignment an account actually needs. Collapsed by default and only
 *  rendered at all once a fetch confirms there's at least one pending
 *  request, so this doesn't add visual clutter for an admin who never
 *  gets any. */
/** Sign-ins (including refused ones), account changes and sharing, newest first. */
function ActivityLogSection() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.getAuditLog>>>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.getAuditLog({ limit: 200, action: filter || undefined }).then(setRows).catch(() => setError("Couldn't load the activity log."));
  }, [open, filter]);

  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={() => setOpen((v) => !v)} style={backBtnStyle}>
        {open ? "Hide activity log" : "Activity log"}
      </button>
      {open && (
        <div className="panel" style={{ marginTop: 10, padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {[["", "All"], ["login", "Sign-ins"], ["login.failed", "Failed"], ["login.locked", "Locked"], ["share", "Sharing"], ["account", "Accounts"]].map(([v, label]) => (
              <button key={v} onClick={() => setFilter(v)} style={{ ...backBtnStyle, color: filter === v ? "var(--text-primary)" : "var(--text-muted)" }}>
                {label}
              </button>
            ))}
          </div>
          {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
          <div style={{ maxHeight: 320, overflowY: "auto", fontSize: 11.5 }} className="mono">
            {rows.length === 0 && !error && <div style={{ color: "var(--text-muted)" }}>Nothing recorded yet.</div>}
            {rows.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 10, padding: "3px 0", borderBottom: "1px solid var(--border-soft)" }}>
                <span style={{ color: "var(--text-faint)", width: 135, flexShrink: 0 }}>{new Date(r.at).toLocaleString()}</span>
                <span style={{ width: 110, flexShrink: 0 }}>{r.username ?? "—"}</span>
                <span style={{ width: 120, flexShrink: 0, color: r.action.includes("fail") || r.action.includes("lock") || r.action.includes("block") ? "var(--critical)" : undefined }}>{r.action}</span>
                <span style={{ color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.detail ?? ""}>
                  {r.detail ?? ""} {r.ip ? `· ${r.ip}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Where this client's alerts may be delivered. Empty means nowhere but their own browser. */
function AlertDestinationsSection({ client, onSaved }: { client: ClientOrg; onSaved: () => void }) {
  const [domains, setDomains] = useState(client.alert_email_domains ?? "");
  const [numbers, setNumbers] = useState(client.alert_signal_numbers ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    try {
      await api.updateClient(client.id, { alert_email_domains: domains, alert_signal_numbers: numbers });
      setMsg("Saved.");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't save.");
    }
  }
  return (
    <>
      <div className="eyebrow" style={{ marginTop: 20, marginBottom: 10 }}>
        ALERT DESTINATIONS
      </div>
      <div className="panel" style={{ padding: "12px 14px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          Alerts carry analysis the client is licensed to read, so they can only be sent to the client's own email domain(s) and to Signal numbers you approve. Leave empty to allow browser notifications only.
        </div>
        <input placeholder="Email domains, e.g. acme.org" value={domains} onChange={(e) => setDomains(e.target.value)} style={inputStyle} />
        <input placeholder="Approved Signal numbers, e.g. +254712345678" value={numbers} onChange={(e) => setNumbers(e.target.value)} style={inputStyle} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={save} style={primaryBtnStyle}>
            Save
          </button>
          {msg && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{msg}</span>}
        </div>
      </div>
    </>
  );
}

function AccessRequestsSection({ onCreateAccount, onDeny }: { onCreateAccount: (r: AccessRequest) => void; onDeny: () => void }) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(true);

  async function load() {
    setRequests(await api.listAccessRequests());
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  async function deny(id: string) {
    await api.reviewAccessRequest(id, "denied");
    onDeny();
  }

  if (!loaded) return null;
  const pending = requests.filter((r) => r.status === "pending");
  if (pending.length === 0) return null;

  return (
    <div className="panel" style={{ padding: "14px 16px", marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
        <div className="eyebrow">ACCESS REQUESTS ({pending.length} pending)</div>
        <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {pending.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: "var(--panel-raised)", borderRadius: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.name} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>— {r.email}</span>
                </div>
                {r.organization && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{r.organization}</div>}
                {r.reason && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.4 }}>{r.reason}</div>}
                <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>{new Date(r.created_at).toLocaleString()}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => onCreateAccount(r)} style={{ ...backBtnStyle, borderColor: "var(--signal)" }}>
                  Create account
                </button>
                <button onClick={() => deny(r.id)} style={{ ...backBtnStyle, color: "var(--critical)" }}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A username from an email address: lower case, letters, digits and . _ - only, at least three characters. */
function usernameFrom(email: string) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return base.length >= 3 ? base.slice(0, 40) : "";
}

function NewClientForm({ onCreated, fromRequest, onFinished }: { onCreated: () => void; fromRequest?: AccessRequest | null; onFinished?: () => void }) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Opening from a request fills in what the request says. The admin still sets the password and the client's details.
  useEffect(() => {
    if (!fromRequest) return;
    setRequestId(fromRequest.id);
    setName(fromRequest.organization || fromRequest.name);
    setDisplayName(fromRequest.name);
    setUsername(usernameFrom(fromRequest.email));
    setPassword("");
    setError(null);
    setOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromRequest?.id]);
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
    if (username.trim().length < 3 || password.length < 12) {
      return setError("Username needs 3+ characters and password needs 12+ characters.");
    }
    setSubmitting(true);
    try {
      await api.createClient({
        name: name.trim(),
        max_accounts: maxAccounts,
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
        access_request_id: requestId ?? undefined,
      });
      reset();
      setRequestId(null);
      setOpen(false);
      await onCreated();
      onFinished?.();
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
    <form ref={formRef} onSubmit={handleSubmit} className="panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8, maxWidth: 400 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>
        {requestId ? "CREATE ACCOUNT FOR ACCESS REQUEST" : "NEW CLIENT"}
      </div>
      {requestId && fromRequest && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, marginBottom: 4 }}>
          From {fromRequest.name} ({fromRequest.email}). The request is marked approved once this account is created.
        </div>
      )}
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
      <input placeholder="Password (12+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
      {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="submit" disabled={submitting} style={primaryBtnStyle}>
          {submitting ? "Creating…" : "Create client"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setRequestId(null);
            setOpen(false);
            onFinished?.();
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
  const [tab, setTab] = useState<ClientTab>(isPlatformAdmin ? "details" : "team");

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

  async function handleToggle(userId: string, patch: { read_only?: boolean; disabled?: boolean }) {
    setError(null);
    try {
      await api.updateClientAccount(clientId, userId, patch);
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
    try {
      await api.deleteClient(clientId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete this client.");
      return;
    }
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
  // The platform admin sees every tab; a client's own team manager sees their team and their logo.
  const tabs: { key: ClientTab; label: string }[] = isPlatformAdmin
    ? [
        { key: "details", label: "Details" },
        { key: "access", label: client.paused ? "Access (paused)" : "Access" },
        { key: "countries", label: "Countries" },
        { key: "resources", label: "Resources" },
        { key: "team", label: "Team" },
        { key: "delete", label: "Delete" },
      ]
    : [
        { key: "team", label: "Team" },
        { key: "details", label: "Logo" },
      ];
  const current = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  async function setFlag(patch: Parameters<typeof api.updateClient>[1]) {
    setError(null);
    try {
      await api.updateClient(clientId, patch);
      await load();
      onClientChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that setting.");
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <button onClick={onBack} style={backBtnStyle}>
        {isPlatformAdmin ? "← All clients" : "← Back"}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0 12px" }}>
        {client.logo_data && (
          <img src={client.logo_data} alt={`${client.name} logo`} style={{ width: 40, height: 40, borderRadius: 6, objectFit: "contain", background: "var(--panel-raised)" }} />
        )}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            {client.name}
            {client.paused && <span style={pausedBadgeStyle}>Paused</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {accounts.length} of {client.max_accounts} account{client.max_accounts === 1 ? "" : "s"} used
          </div>
        </div>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 18, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={current === t.key} onClick={() => setTab(t.key)} style={tabStyle(current === t.key, t.key === "delete")}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "var(--critical)", background: "color-mix(in srgb, var(--critical) 8%, transparent)", padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {current === "details" && (
        <>
          {isPlatformAdmin && <ClientDetailsForm client={client} onSaved={async () => (await load(), onClientChanged())} />}
          <ClientLogoSection client={client} onSaved={load} />
          {isPlatformAdmin && <AlertDestinationsSection client={client} onSaved={load} />}
        </>
      )}

      {current === "access" && isPlatformAdmin && <PauseSection client={client} onChanged={async () => (await load(), onClientChanged())} />}

      {current === "countries" && isPlatformAdmin && <CountryAccessSection clientId={clientId} />}

      {current === "resources" && isPlatformAdmin && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            PARTS OF THE LENS
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            What this client's logins can open. A part that is switched off disappears from their menus and its data is refused by the server.
          </div>
          <AccessToggle checked={client.can_live_osint !== false} title="Live OSINT" desc="The live map, escalation alerts, layers, Alerts, Telegram, Events and live monitoring queries." onChange={() => setFlag({ can_live_osint: client.can_live_osint === false })} />
          <AccessToggle checked={client.can_trends !== false} title="Trends & Patterns" desc="Incidents, dashboards, the incident map, uploads and datasets." onChange={() => setFlag({ can_trends: client.can_trends === false })} />
          <AccessToggle checked={client.can_afrintel !== false} title="AfrIntel" desc="The forecasting engine and talk-to-the-map assistant on Live OSINT. Uses the Lens's AI allowance." onChange={() => setFlag({ can_afrintel: client.can_afrintel === false })} />
          <AccessToggle checked={!!client.can_view_spotlight} title="Regional Spotlight" desc="Published publications, the country pages and the Kenya Election Watch. Off by default." onChange={() => setFlag({ can_view_spotlight: !client.can_view_spotlight })} />
          <AccessToggle checked={!!client.can_screen_people} title="Due-diligence screening" desc="Looks up named people and companies, which is personal data. Each run is logged, and saved cases are deleted after 90 days. Off by default." onChange={() => setFlag({ can_screen_people: !client.can_screen_people })} />

          <div className="eyebrow" style={{ marginTop: 22, marginBottom: 10 }}>
            DATA PERMISSIONS
          </div>
          <AccessToggle checked={client.can_view_all_incidents} title="See the full shared incidents pool" desc="View-only: this client's logins still can't edit or delete anyone else's incidents, only their own." onChange={() => setFlag({ can_view_all_incidents: !client.can_view_all_incidents })} />
          <AccessToggle checked={!!client.can_share_publicly} title="Allow public share links" desc="Off by default. When on, this client's logins can create dashboard links that work without signing in." onChange={() => setFlag({ can_share_publicly: !client.can_share_publicly })} />

          <AllowancesSection clientId={clientId} />

          <SharedItemsSection
            title="SHARED DASHBOARDS"
            clientId={clientId}
            listGranted={api.listClientDashboards}
            listAvailable={async () => (await api.getCustomDashboards()).filter((d) => !d.is_auto).map((d) => ({ id: d.id, name: d.name }))}
            grant={api.grantClientDashboard}
            revoke={api.revokeClientDashboard}
            idKey="dashboard_id"
            emptyLabel="No dashboards shared with this client yet."
            pickerLabel="Share a dashboard…"
          />

          <SharedItemsSection
            title="SHARED DATASETS"
            clientId={clientId}
            listGranted={api.listClientDatasets}
            listAvailable={async () => (await api.getDatasets()).map((d) => ({ id: d.id, name: d.name }))}
            grant={api.grantClientDataset}
            revoke={api.revokeClientDataset}
            idKey="dataset_id"
            emptyLabel="No datasets shared with this client yet."
            pickerLabel="Share a dataset…"
          />
        </>
      )}

      {current === "team" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {accounts.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No logins yet.</div>}
            {accounts.map((u) => (
              <div key={u.id} className="panel" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.display_name || u.username}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                    {u.username}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={u.is_client_admin} disabled={!!u.read_only} onChange={() => handleToggleAdmin(u.id, u.is_client_admin)} />
                  Can manage team
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer" }} title="A viewer can look at everything they're allowed to see, but can't change, upload, share or export anything.">
                  <input type="checkbox" checked={!!u.read_only} onChange={() => handleToggle(u.id, { read_only: !u.read_only })} />
                  Viewer only
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: u.disabled ? "var(--critical)" : "var(--text-muted)", cursor: "pointer" }} title="Switches this one login off and signs it out, without deleting anything.">
                  <input type="checkbox" checked={!!u.disabled} onChange={() => handleToggle(u.id, { disabled: !u.disabled })} />
                  Disabled
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
              <button onClick={() => setShowAddAccount(true)} disabled={atLimit} title={atLimit ? "This client is at its account limit: raise it under Details to add more." : undefined} style={primaryBtnStyle}>
                + Add account{atLimit ? " (at limit)" : ""}
              </button>
            )}
          </div>
        </>
      )}

      {current === "delete" && isPlatformAdmin && <DeleteClientSection client={client} onDelete={handleDeleteClient} onPauseInstead={() => setTab("access")} />}
    </div>
  );
}

type ClientTab = "details" | "access" | "countries" | "resources" | "team" | "delete";

const tabStyle = (on: boolean, danger = false): React.CSSProperties => ({
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: on ? 700 : 500,
  fontFamily: "inherit",
  cursor: "pointer",
  background: "transparent",
  border: "none",
  borderBottom: `2px solid ${on ? (danger ? "var(--critical)" : "var(--accent, #D4AF37)") : "transparent"}`,
  color: danger ? "var(--critical)" : on ? "var(--text-primary)" : "var(--text-muted)",
  marginBottom: -1,
});

const pausedBadgeStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--critical)", border: "1px solid var(--critical)", borderRadius: 4, padding: "1px 6px" };

/** One on/off permission, with what it means underneath. */
function AccessToggle({ checked, title, desc, onChange }: { checked: boolean; title: string; desc: string; onChange: () => void }) {
  return (
    <label className="panel" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", marginBottom: 8 }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{desc}</div>
      </div>
    </label>
  );
}

/** Pause or resume the whole client: every login stops at once, nothing is deleted. */
function PauseSection({ client, onChanged }: { client: ClientOrg; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(paused: boolean) {
    if (paused && !window.confirm(`Pause "${client.name}"? All ${client.account_count} of its logins will stop working straight away. Nothing is deleted.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.pauseClient(client.id, paused, paused ? reason : undefined);
      setReason("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change that.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel" style={{ padding: "16px 18px", maxWidth: 620 }}>
      {client.paused ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--critical)", marginBottom: 6 }}>Access is paused</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 4 }}>
            Since {client.paused_at ? new Date(client.paused_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
            {client.pause_reason ? `. Reason: ${client.pause_reason}` : ""}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>Its logins see a notice that access is paused and can do nothing else. Their data, dashboards and settings are kept.</div>
          <button onClick={() => void act(false)} disabled={busy} style={primaryBtnStyle}>
            {busy ? "Resuming…" : "Resume access"}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Access is active</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
            Pausing stops every login of this client at once (for example while an invoice is overdue or a contract is being renewed). Nothing is deleted, and resuming restores everything as it was. To switch off one person only, use Disabled on the Team tab.
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>
            Reason (shown to the client's logins)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Subscription renewal pending" style={inputStyle} />
          </label>
          <button onClick={() => void act(true)} disabled={busy} style={dangerBtnStyle}>
            {busy ? "Pausing…" : "Pause access"}
          </button>
        </>
      )}
      {error && <div style={{ color: "var(--critical)", fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

/** Deleting a client, with its consequences spelled out and its name typed to confirm. */
function DeleteClientSection({ client, onDelete, onPauseInstead }: { client: ClientOrg; onDelete: () => void; onPauseInstead: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="panel" style={{ padding: "16px 18px", maxWidth: 620, borderColor: "var(--critical)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--critical)", marginBottom: 6 }}>Delete this client</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        This permanently removes {client.name} and all {client.account_count} of its logins, along with its country restrictions and sharing. It can't be undone. If you only need to stop access for a while,{" "}
        <button onClick={onPauseInstead} style={{ background: "none", border: "none", padding: 0, color: "var(--accent, #D4AF37)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
          pause it instead
        </button>
        .
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>
        Type the client's name to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={client.name} style={inputStyle} />
      </label>
      <button onClick={onDelete} disabled={typed.trim() !== client.name.trim()} style={{ ...dangerBtnStyle, opacity: typed.trim() === client.name.trim() ? 1 : 0.5 }}>
        Delete {client.name}
      </button>
    </div>
  );
}

/** Visible to both the platform admin and that client's own client-admin —
 *  unlike renaming a client or changing its account limit (platform-only
 *  decisions), a client's own branding is naturally theirs to set for
 *  themselves. Checked client-side against the same size limit the backend
 *  enforces (290KB raw file, comfortably under the 400KB base64-encoded
 *  cap — see MAX_LOGO_DATA_URL_LENGTH in clients.ts) so a too-large file is
 *  rejected immediately rather than after a full upload round-trip. */
function ClientLogoSection({ client, onSaved }: { client: ClientOrg; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const MAX_RAW_BYTES = 290_000;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets picking the same file again re-trigger onChange
    if (!file) return;
    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_RAW_BYTES) {
      setError(`That image is too large (${Math.round(file.size / 1024)}KB) — please use one under ${Math.round(MAX_RAW_BYTES / 1024)}KB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      setSaving(true);
      try {
        await api.updateClientLogo(client.id, String(reader.result));
        await onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save that logo.");
      } finally {
        setSaving(false);
      }
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsDataURL(file);
  }

  async function handleRemove() {
    setError(null);
    setSaving(true);
    try {
      await api.updateClientLogo(client.id, null);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that logo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
      {client.logo_data ? (
        <img src={client.logo_data} alt="Current logo" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "contain", background: "var(--panel-raised)" }} />
      ) : (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 8,
            background: "var(--panel-raised)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "var(--text-faint)",
            textAlign: "center",
          }}
        >
          No logo
        </div>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Client logo</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ ...backBtnStyle, display: "inline-block", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : client.logo_data ? "Change" : "Upload"}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={handleFileChange} disabled={saving} style={{ display: "none" }} />
          </label>
          {client.logo_data && (
            <button onClick={handleRemove} disabled={saving} style={dangerBtnStyle}>
              Remove
            </button>
          )}
        </div>
        {error && <div style={{ color: "var(--critical)", fontSize: 11.5, marginTop: 6 }}>{error}</div>}
      </div>
    </div>
  );
}

/** The client's name, account limit, contact details and notes. */
function ClientDetailsForm({ client, onSaved }: { client: ClientOrg; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: client.name,
    max_accounts: client.max_accounts,
    contact_name: client.contact_name ?? "",
    contact_email: client.contact_email ?? "",
    contact_phone: client.contact_phone ?? "",
    notes: client.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: k === "max_accounts" ? Math.max(1, Number(e.target.value) || 1) : e.target.value }));
  };

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await api.updateClient(client.id, { ...form, name: form.name.trim() || client.name });
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save those changes.");
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, el: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
      {label}
      {el}
    </label>
  );
  return (
    <div className="panel" style={{ padding: "14px 16px", marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, maxWidth: 760 }}>
      {field("Organisation name", <input value={form.name} onChange={set("name")} style={inputStyle} />)}
      {field("Max accounts", <input type="number" min={1} max={50} value={form.max_accounts} onChange={set("max_accounts")} style={{ ...inputStyle, width: 90 }} />)}
      {field("Contact person", <input value={form.contact_name} onChange={set("contact_name")} style={inputStyle} />)}
      {field("Contact email", <input type="email" value={form.contact_email} onChange={set("contact_email")} style={inputStyle} />)}
      {field("Contact phone", <input value={form.contact_phone} onChange={set("contact_phone")} style={inputStyle} />)}
      <div style={{ gridColumn: "1 / -1" }}>{field("Notes (only you see these)", <textarea value={form.notes} onChange={set("notes")} rows={3} style={{ ...inputStyle, resize: "vertical", width: "100%", boxSizing: "border-box" }} />)}</div>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
          {saving ? "Saving…" : "Save details"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Saved.</span>}
        {error && <span style={{ color: "var(--critical)", fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}

/** Reusable for both dashboards and datasets — same shape of "here's what's
 *  already shared, here's a picker of everything else you own that isn't
 *  shared yet" for either kind of item. */
/** A client with no countries listed here is unrestricted — this section
 *  turning restriction ON is additive, not a required setup step. Plain
 *  text input rather than a fixed dropdown: incident data's country field
 *  comes from whatever a spreadsheet actually says, which won't
 *  necessarily match any single fixed naming convention, so the admin
 *  needs to be able to type exactly what that client's own data uses. */
function CountryAccessSection({ clientId }: { clientId: string }) {
  const [countries, setCountries] = useState<{ country: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCountry, setNewCountry] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setCountries(await api.listClientCountries(clientId));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newCountry.trim()) return;
    setError(null);
    setAdding(true);
    try {
      await api.grantClientCountry(clientId, newCountry.trim());
      setNewCountry("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that country.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(country: string) {
    setError(null);
    try {
      await api.revokeClientCountry(clientId, country);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that country.");
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        COUNTRY ACCESS (INCIDENTS)
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
        {countries.length === 0
          ? "Unrestricted — this client can view and upload incidents for any country. Add one below to restrict them to specific countries only."
          : "Restricted to the countries below, for both viewing and uploading — type the country exactly as it appears in this client's own data."}
      </div>
      {error && <div style={{ color: "var(--critical)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {loading ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <>
          {countries.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {countries.map((c) => (
                <span
                  key={c.country}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    padding: "4px 8px 4px 10px",
                    borderRadius: 999,
                    background: "var(--panel-raised)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {c.country}
                  <button
                    onClick={() => handleRemove(c.country)}
                    title={`Remove ${c.country}`}
                    style={{ background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={handleAdd} style={{ display: "flex", gap: 8 }}>
            <input
              value={newCountry}
              onChange={(e) => setNewCountry(e.target.value)}
              placeholder="Country name, e.g. Kenya"
              style={{ ...inputStyle, flex: 1, maxWidth: 240 }}
            />
            <button type="submit" disabled={adding || !newCountry.trim()} style={backBtnStyle}>
              {adding ? "Adding…" : "+ Add country"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function SharedItemsSection({
  title,
  clientId,
  listGranted,
  listAvailable,
  grant,
  revoke,
  idKey,
  emptyLabel,
  pickerLabel,
}: {
  title: string;
  clientId: string;
  listGranted: (clientId: string) => Promise<ClientSharedItem[]>;
  listAvailable: () => Promise<{ id: string; name: string }[]>;
  grant: (clientId: string, itemId: string) => Promise<{ ok: boolean }>;
  revoke: (clientId: string, itemId: string) => Promise<void>;
  idKey: "dashboard_id" | "dataset_id";
  emptyLabel: string;
  pickerLabel: string;
}) {
  const [granted, setGranted] = useState<ClientSharedItem[]>([]);
  const [available, setAvailable] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [g, a] = await Promise.all([listGranted(clientId), listAvailable()]);
    setGranted(g);
    setAvailable(a);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const grantedIds = new Set(granted.map((g) => g[idKey]));
  const pickableItems = available.filter((a) => !grantedIds.has(a.id));

  async function handleGrant() {
    if (!selectedId) return;
    setError(null);
    try {
      await grant(clientId, selectedId);
      setSelectedId("");
      setSelecting(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't share that.");
    }
  }

  async function handleRevoke(itemId: string) {
    setError(null);
    try {
      await revoke(clientId, itemId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that.");
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {title}
      </div>
      {error && <div style={{ color: "var(--critical)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {loading ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <>
          {granted.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginBottom: 8 }}>{emptyLabel}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {granted.map((item) => (
                <div key={item[idKey] ?? item.name} className="panel" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px" }}>
                  <div style={{ flex: 1, fontSize: 13 }}>{item.name}</div>
                  <button onClick={() => handleRevoke(item[idKey]!)} style={dangerBtnStyle}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {selecting ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={inputStyle}>
                <option value="">Choose…</option>
                {pickableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button onClick={handleGrant} disabled={!selectedId} style={primaryBtnStyle}>
                Share
              </button>
              <button onClick={() => setSelecting(false)} style={backBtnStyle}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setSelecting(true)} disabled={pickableItems.length === 0} title={pickableItems.length === 0 ? "Nothing left to share" : undefined} style={backBtnStyle}>
              {pickerLabel}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** This month's use against each allowance, and the limits this client has. */
function AllowancesSection({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getClientUsage>> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const d = await api.getClientUsage(clientId);
    setData(d);
    const next: Record<string, string> = {};
    for (const m of d.monthly) next[m.kind] = String(m.limit);
    for (const s of d.stock) next[s.kind] = String(s.limit);
    setDraft(next);
  }
  useEffect(() => {
    load().catch(() => setMsg("Couldn't load allowances."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function save() {
    if (!data) return;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(draft)) {
      const n = Math.max(0, Math.round(Number(v)));
      if (Number.isFinite(n) && n !== data.defaults[k]) out[k] = n;
    }
    try {
      await api.setClientQuotas(clientId, out);
      setMsg("Saved.");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  if (!data) return null;
  const row = (kind: string, label: string, used?: number) => (
    <div key={kind} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
      <div style={{ flex: 1 }}>{label}</div>
      {used !== undefined && <div className="mono" style={{ color: "var(--text-muted)", width: 60, textAlign: "right" }}>{used} used</div>}
      <input
        type="number"
        min={0}
        value={draft[kind] ?? ""}
        onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })}
        style={{ ...inputStyle, width: 90, padding: "4px 8px" }}
      />
    </div>
  );
  return (
    <>
      <div className="eyebrow" style={{ marginTop: 20, marginBottom: 10 }}>
        ALLOWANCES
      </div>
      <div className="panel" style={{ padding: "12px 14px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {data.monthly.map((m) => row(m.kind, m.label, m.used))}
        {data.stock.map((s) => row(s.kind, s.label))}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={save} style={primaryBtnStyle}>
            Save limits
          </button>
          {msg && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{msg}</span>}
        </div>
      </div>
    </>
  );
}

function NewAccountForm({ clientId, onCreated, onCancel }: { clientId: string; onCreated: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [viewer, setViewer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (username.trim().length < 3 || password.length < 12) {
      return setError("Username needs 3+ characters and password needs 12+ characters.");
    }
    setSubmitting(true);
    try {
      await api.createClientAccount(clientId, { username: username.trim(), password, display_name: displayName.trim() || undefined, read_only: viewer });
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
      <input placeholder="Password (12+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
        <input type="checkbox" checked={viewer} onChange={(e) => setViewer(e.target.checked)} />
        Viewer only (can look, can't change or export)
      </label>
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
