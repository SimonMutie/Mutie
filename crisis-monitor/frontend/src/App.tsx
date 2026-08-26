import { useCallback, useEffect, useState } from "react";
import { api, connectLiveFeed, getToken, setToken, type AuthUser, type MonitoringQueryItem } from "./api";
import TopBar from "./components/TopBar";
import AuthScreen from "./components/AuthScreen";
import QueryList from "./components/QueryList";
import QueryDashboard from "./components/QueryDashboard";
import QueryEditor from "./components/QueryEditor";
import AdminPanel from "./components/AdminPanel";
import IncidentsDashboard from "./components/IncidentsDashboard";
import PublicDashboardView from "./components/PublicDashboardView";

type BootState = "checking" | "bootstrap" | "login" | "authed";
type View = "list" | { queryId: string } | "admin" | "new-query" | { editQueryId: string } | "incidents";

/** Minimal, single-purpose routing: this app is otherwise entirely
 *  state-driven (no URLs for any authenticated view), but a "share for live
 *  viewing" link has to work for people who aren't logged in at all — so this
 *  one path is checked before anything else, completely bypassing the normal
 *  auth-gated app shell below. */
function usePublicShareToken(): string | null {
  const path = window.location.pathname;
  const match = /^\/shared\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  return match ? match[1] : null;
}

export default function App() {
  const shareToken = usePublicShareToken();
  const [bootState, setBootState] = useState<BootState>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<View>("list");
  const [queries, setQueries] = useState<MonitoringQueryItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [liveMessage, setLiveMessage] = useState<{ type: string; payload: unknown } | null>(null);

  // Resolve whether we need first-run setup, a login screen, or are already authenticated (existing token).
  useEffect(() => {
    if (shareToken) return; // public share link — no auth flow needed at all
    (async () => {
      const existingToken = getToken();
      if (existingToken) {
        try {
          const me = await api.me();
          setUser(me);
          setBootState("authed");
          return;
        } catch {
          setToken(null); // stale/expired token
        }
      }
      const { bootstrapNeeded } = await api.authStatus();
      setBootState(bootstrapNeeded ? "bootstrap" : "login");
    })();
  }, []);

  const loadQueries = useCallback(async () => {
    setQueries(await api.getQueries());
  }, []);

  useEffect(() => {
    if (shareToken || bootState !== "authed") return;
    loadQueries();
    const interval = setInterval(loadQueries, 15000);
    return () => clearInterval(interval);
  }, [shareToken, bootState, loadQueries]);

  useEffect(() => {
    if (shareToken || bootState !== "authed") return;
    const disconnect = connectLiveFeed((type, payload) => {
      setConnected(true);
      setLiveMessage({ type, payload });
    });
    return () => disconnect();
  }, [shareToken, bootState]);

  function handleAuthenticated(authedUser: AuthUser) {
    setUser(authedUser);
    setBootState("authed");
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
    setQueries([]);
    setView("list");
    setConnected(false);
    setBootState("login");
  }

  if (shareToken) {
    return <PublicDashboardView token={shareToken} />;
  }

  if (bootState === "checking") {
    return <div style={{ height: "100vh" }} />;
  }

  if (bootState === "bootstrap" || bootState === "login") {
    return <AuthScreen mode={bootState} onAuthenticated={handleAuthenticated} />;
  }

  if (!user) return null; // unreachable once authed, keeps TS happy

  const openQuery = typeof view === "object" && "queryId" in view ? queries.find((q) => q.id === view.queryId) : undefined;
  const editingQuery = typeof view === "object" && "editQueryId" in view ? queries.find((q) => q.id === view.editQueryId) : undefined;

  async function handleSaved(saved: MonitoringQueryItem) {
    await loadQueries();
    setView({ queryId: saved.id });
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar
        connected={connected}
        user={user}
        view={view === "admin" ? "admin" : view === "list" ? "list" : view === "incidents" ? "incidents" : "dashboard"}
        onNavigate={(v) => setView(v)}
        onLogout={handleLogout}
      />

      {view === "admin" && <AdminPanel onBack={() => setView("list")} />}

      {view === "incidents" && <IncidentsDashboard />}

      {view === "list" && (
        <QueryList
          queries={queries}
          onChanged={loadQueries}
          onOpen={(queryId) => setView({ queryId })}
          onNew={() => setView("new-query")}
          onEdit={(queryId) => setView({ editQueryId: queryId })}
        />
      )}

      {view === "new-query" && <QueryEditor mode="create" onCancel={() => setView("list")} onSaved={handleSaved} />}

      {typeof view === "object" &&
        "editQueryId" in view &&
        (editingQuery ? (
          <QueryEditor
            mode="edit"
            existingQuery={editingQuery}
            onCancel={() => setView({ queryId: editingQuery.id })}
            onSaved={handleSaved}
          />
        ) : (
          <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading…</div>
        ))}

      {typeof view === "object" &&
        "queryId" in view &&
        (openQuery ? (
          <QueryDashboard
            query={openQuery}
            liveMessage={liveMessage}
            onBack={() => setView("list")}
            onEdit={() => setView({ editQueryId: openQuery.id })}
          />
        ) : (
          // query list hasn't loaded yet, or the query was deleted/no longer accessible
          <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading…</div>
        ))}
    </div>
  );
}
