import { setSessionUser } from "./session";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import AlertPopups from "./components/AlertPopups";
import { api, connectLiveFeed, getToken, setToken, type AuthUser, type MonitoringQueryItem } from "./api";
import TopBar from "./components/TopBar";
import AuthScreen from "./components/AuthScreen";
import PushPrompt from "./components/PushPrompt";
import { enableMonitorLayer } from "./monitorLayers";
import type { SpotlightScope } from "./spotlightRegions";
import { speakWelcomeIfPending } from "./intro";

const QueryDashboard = lazy(() => import("./components/QueryDashboard"));
const QueryEditor = lazy(() => import("./components/QueryEditor"));
const AdminPanel = lazy(() => import("./components/AdminPanel"));
const BroadcastAlerts = lazy(() => import("./components/BroadcastAlerts"));
const SourcesRegister = lazy(() => import("./components/SourcesRegister"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const IncidentsDashboard = lazy(() => import("./components/IncidentsDashboard"));
const DueDiligenceView = lazy(() => import("./components/DueDiligenceView"));
const PublicDashboardView = lazy(() => import("./components/PublicDashboardView"));
const LiveIntelView = lazy(() => import("./components/LiveIntelView"));
const RegionalSpotlight = lazy(() => import("./components/RegionalSpotlight"));
const PublicSpotlightView = lazy(() => import("./components/PublicSpotlightView"));

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
/** Two top-level sections — Trends & Patterns ("incidents", which now also
 *  holds Datasets) and Live OSINT. Live Monitoring lives inside Live OSINT:
 *  its queries are listed and toggled in the Monitor tool on the map, and a
 *  query's dashboard / editor are the three object-or-"new-query" views
 *  here, reached from that tool and returning to it. */
type View = { queryId: string } | "admin" | "sources" | "broadcast" | "settings" | "new-query" | { editQueryId: string } | "incidents" | "live-osint" | "due-diligence" | { spotlight: SpotlightScope };

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

/** The other path that works without signing in: a Regional Spotlight
 *  publication opened from its public link (/spotlight/<id>). */
function usePublicSpotlightId(): string | null {
  const match = /^\/spotlight\/([A-Za-z0-9-]+)\/?$/.exec(window.location.pathname);
  return match ? match[1] : null;
}

export default function App() {
  const publicSpotlightId = usePublicSpotlightId();
  const sharedDashboardToken = usePublicShareToken();
  // Either public path skips the whole sign-in flow below.
  const shareToken = sharedDashboardToken ?? publicSpotlightId;
  const [bootState, setBootState] = useState<BootState>("checking");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootTry, setBootTry] = useState(0);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const setUser = (u: AuthUser | null) => {
    setSessionUser(u);
    setUserState(u);
  };
  const [view, setView] = useState<View>("live-osint");
  // Set when coming back from a monitoring page, so the map reopens with
  // the Monitor tool showing instead of dropping the user on a bare map.
  const [openMonitorTool, setOpenMonitorTool] = useState(false);
  const [ddKind, setDdKind] = useState<"entity" | "person">("entity");

  function backToMonitoring() {
    setOpenMonitorTool(true);
    setView("live-osint");
  }
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
      try {
        const { bootstrapNeeded } = await api.authStatus();
        setBootState(bootstrapNeeded ? "bootstrap" : "login");
      } catch (e) {
        // The server couldn't be reached (or errored) — show that instead of a blank page.
        setBootError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [bootTry]);

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
    // Signing in is something the visitor did, so the browser now allows
    // sound: if the spoken welcome was refused when the site opened, say it.
    speakWelcomeIfPending();
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

  if (publicSpotlightId) {
    return (
      <Suspense fallback={viewLoadingFallback}>
        <PublicSpotlightView id={publicSpotlightId} />
      </Suspense>
    );
  }

  if (sharedDashboardToken) {
    return (
      <Suspense fallback={viewLoadingFallback}>
        <PublicDashboardView token={sharedDashboardToken} />
      </Suspense>
    );
  }

  if (bootState === "checking") {
    if (bootError) {
      return (
        <div style={{ height: "100vh", display: "grid", placeItems: "center", color: "#e8e6e0", font: "14px system-ui, sans-serif", padding: 24, textAlign: "center" }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>The Lens can't reach its server</div>
            <div style={{ opacity: 0.7, marginBottom: 14 }}>{bootError}</div>
            <button onClick={() => { setBootError(null); setBootTry((n) => n + 1); }} style={{ padding: "8px 18px", cursor: "pointer" }}>Try again</button>
          </div>
        </div>
      );
    }
    return <div style={{ height: "100vh" }} />;
  }

  if (bootState === "bootstrap" || bootState === "login") {
    return <AuthScreen mode={bootState} onAuthenticated={handleAuthenticated} />;
  }

  if (!user) return null; // unreachable once authed, keeps TS happy

  const openQuery = typeof view === "object" && "queryId" in view ? queries.find((q) => q.id === view.queryId) : undefined;
  const editingQuery = typeof view === "object" && "editQueryId" in view ? queries.find((q) => q.id === view.editQueryId) : undefined;

  const spotlightScope = typeof view === "object" && "spotlight" in view ? view.spotlight : null;

  async function handleSaved(saved: MonitoringQueryItem, created: boolean) {
    // A newly created query is shown on the Live OSINT map straight away;
    // it can be switched off again from the Monitor tool.
    if (created) enableMonitorLayer(saved.id);
    await loadQueries();
    setView({ queryId: saved.id });
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar
        connected={connected}
        user={user}
        view={view === "admin" || view === "sources" || view === "broadcast" || view === "settings" || view === "incidents" || view === "live-osint" || view === "due-diligence" ? view : spotlightScope ? "spotlight" : "monitoring"}
        spotlightScope={spotlightScope}
        ddKind={ddKind}
        onOpenDueDiligence={(k) => {
          setOpenMonitorTool(false);
          setDdKind(k);
          setView("due-diligence");
        }}
        onOpenSpotlight={(scope) => {
          setOpenMonitorTool(false);
          setView({ spotlight: scope });
        }}
        onNavigate={(v) => {
          setOpenMonitorTool(false);
          setView(v);
        }}
        onLogout={handleLogout}
      />

      <PushPrompt />
      <AlertPopups liveMessage={liveMessage} onOpenQuery={(queryId) => setView({ queryId })} onShowOnMap={() => { setOpenMonitorTool(false); setView("live-osint"); }} />

      <Suspense fallback={viewLoadingFallback}>
        {view === "admin" && <AdminPanel user={user} onBack={() => setView("live-osint")} />}

        {view === "sources" && user.role === "admin" && <SourcesRegister onBack={() => setView("live-osint")} />}

        {view === "broadcast" && user.role === "admin" && <BroadcastAlerts onBack={() => setView("live-osint")} />}

        {view === "settings" && <SettingsPanel user={user} onBack={() => setView("live-osint")} />}

        {view === "incidents" && <IncidentsDashboard user={user} />}

        {view === "due-diligence" && <DueDiligenceView kind={ddKind} />}

        {view === "live-osint" && (
          <LiveIntelView
            queries={queries}
            onQueriesChanged={loadQueries}
            onOpenQuery={(queryId) => setView({ queryId })}
            onNewQuery={() => setView("new-query")}
            onEditQuery={(queryId) => setView({ editQueryId: queryId })}
            initialTool={openMonitorTool ? "monitor" : null}
          />
        )}

        {spotlightScope && <RegionalSpotlight user={user} scope={spotlightScope} onScopeChange={(scope) => setView({ spotlight: scope })} />}

        {view === "new-query" && <QueryEditor mode="create" onCancel={backToMonitoring} onSaved={(q) => handleSaved(q, true)} />}

        {typeof view === "object" &&
          "editQueryId" in view &&
          (editingQuery ? (
            <QueryEditor
              mode="edit"
              existingQuery={editingQuery}
              onCancel={() => setView({ queryId: editingQuery.id })}
              onSaved={(q) => handleSaved(q, false)}
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
              onBack={backToMonitoring}
              onEdit={() => setView({ editQueryId: openQuery.id })}
              onShowOnMap={() => {
                enableMonitorLayer(openQuery.id);
                backToMonitoring();
              }}
            />
          ) : (
            // query list hasn't loaded yet, or the query was deleted/no longer accessible
            <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading…</div>
          ))}
      </Suspense>
    </div>
  );
}
