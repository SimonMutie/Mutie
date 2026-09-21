import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, connectLiveFeed, getToken, setToken, type AuthUser, type MonitoringQueryItem } from "./api";
import TopBar from "./components/TopBar";
import AuthScreen from "./components/AuthScreen";

const QueryList = lazy(() => import("./components/QueryList"));
const QueryDashboard = lazy(() => import("./components/QueryDashboard"));
const QueryEditor = lazy(() => import("./components/QueryEditor"));
const AdminPanel = lazy(() => import("./components/AdminPanel"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const IncidentsDashboard = lazy(() => import("./components/IncidentsDashboard"));
const DatasetsPanel = lazy(() => import("./components/DatasetsPanel"));
const PublicDashboardView = lazy(() => import("./components/PublicDashboardView"));

/** Each view above used to be a plain, eager import — meaning every
 *  page's code (including the mapping page, IncidentsDashboard) shared
 *  one bundle with every other page's code, choropleth/dashboard
 *  included. Since the choropleth widget grew substantially this
 *  session, every page paid that download/parse cost regardless of
 *  which one was actually being visited — confirmed as the cause of
 *  reported slowness on the mapping page specifically, a page that
 *  doesn't use any of that code at all. These are mutually exclusive
 *  (view is a single value, only one renders at a time), which is
 *  exactly the shape React.lazy is meant for. */
const viewLoadingFallback = <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading…</div>;

type BootState = "checking" | "bootstrap" | "login" | "authed";
type View = "list" | { queryId: string } | "admin" | "settings" | "new-query" | { editQueryId: string } | "incidents" | "datasets";

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
  const [view, setView] = useState<View>("incidents");
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
    setView("incidents");
    setConnected(false);
    setBootState("login");
  }

  if (shareToken) {
    return (
      <Suspense fallback={viewLoadingFallback}>
        <PublicDashboardView token={shareToken} />
      </Suspense>
    );
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
        view={
          view === "admin"
            ? "admin"
            : view === "settings"
              ? "settings"
              : view === "list"
                ? "list"
                : view === "incidents"
                  ? "incidents"
                  : view === "datasets"
                    ? "datasets"
                    : "dashboard"
        }
        onNavigate={(v) => setView(v)}
        onLogout={handleLogout}
      />

      <Suspense fallback={viewLoadingFallback}>
        {view === "admin" && <AdminPanel user={user} onBack={() => setView("list")} />}

        {view === "settings" && <SettingsPanel onBack={() => setView("list")} />}

        {view === "incidents" && <IncidentsDashboard user={user} />}

        {view === "datasets" && <DatasetsPanel />}

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
      </Suspense>
    </div>
  );
}
