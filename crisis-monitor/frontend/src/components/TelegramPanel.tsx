import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, type OsintAlertItem, type TelegramChannelStatus } from "../api";

/**
 * The Telegram tool: the latest posts from the channels the Lens follows, and a list of those channels showing
 * which are being read and which have returned nothing. Telegram is unvetted, so every post carries a note on who
 * runs the channel, and nothing here counts as confirmation on its own.
 */
const text = "#e6edf7";
const muted = "#93a1b8";
const line = "1px solid rgba(124,156,255,0.12)";
const tab = (on: boolean): CSSProperties => ({
  padding: "5px 10px",
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
  color: text,
  background: on ? "rgba(124,156,255,0.22)" : "transparent",
  border: "1px solid rgba(124,156,255,0.25)",
  borderRadius: 6,
});

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

type Scope = "africa" | "all";

/** A channel that posted within the last month is slow, not dead. */
const QUIET_DAYS = 30;
const isQuiet = (latest: string | null) => !!latest && Date.now() - Date.parse(latest) <= QUIET_DAYS * 86_400_000;

export default function TelegramPanel() {
  const [view, setView] = useState<"posts" | "channels">("posts");
  const [scope, setScope] = useState<Scope>("africa");
  const [posts, setPosts] = useState<OsintAlertItem[] | null>(null);
  const [channels, setChannels] = useState<TelegramChannelStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([api.getOsintAlerts(), api.getTelegramChannels()])
        .then(([feed, status]) => {
          if (cancelled) return;
          setPosts(feed.alerts.filter((a) => a.source.startsWith("t.me/")));
          setChannels(status.channels);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Telegram feed unavailable"));
    };
    load();
    const id = setInterval(load, 3 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const africa = useMemo(() => new Set((channels ?? []).map((c) => `t.me/${c.handle}`.toLowerCase())), [channels]);
  const shown = useMemo(
    () =>
      (posts ?? [])
        .filter((p) => scope === "all" || africa.has(p.source.toLowerCase()))
        .filter((p) => !channel || p.source.toLowerCase() === `t.me/${channel}`.toLowerCase())
        .sort((a, b) => b.published.localeCompare(a.published)),
    [posts, scope, africa, channel]
  );
  const live = (channels ?? []).filter((c) => c.posts72h > 0).length;
  const silentAll = (channels ?? []).filter((c) => c.fetchedAt && c.posts72h === 0);
  const quiet = silentAll.filter((c) => isQuiet(c.latest));
  const silent = silentAll.filter((c) => !isQuiet(c.latest));
  const waiting = (channels ?? []).filter((c) => !c.fetchedAt).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, color: text, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={tab(view === "posts")} aria-pressed={view === "posts"} onClick={() => setView("posts")}>Latest posts</button>
        <button style={tab(view === "channels")} aria-pressed={view === "channels"} onClick={() => setView("channels")}>Channels{channels ? ` (${channels.length})` : ""}</button>
      </div>
      {error && <div style={{ color: "#ff8f8f", fontSize: 11 }}>Could not load Telegram: {error}</div>}
      {channels && (
        <div style={{ fontSize: 11, color: muted, lineHeight: 1.45 }}>
          {live} of {channels.length} Africa channels have posts from the last 72 hours.
          {quiet.length > 0 && <> {quiet.length} {quiet.length === 1 ? "is" : "are"} quiet (no post in 72 hours, but one in the last month).</>}
          {silent.length > 0 && <> {silent.length} look dead or closed.</>}
          {waiting > 0 && <> {waiting} {waiting === 1 ? "has" : "have"} not been read yet; the Lens reads six at a time, so a new list fills in over about half an hour.</>}
        </div>
      )}

      {view === "posts" && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button style={tab(scope === "africa")} aria-pressed={scope === "africa"} onClick={() => { setScope("africa"); setChannel(""); }}>Africa channels</button>
            <button style={tab(scope === "all")} aria-pressed={scope === "all"} onClick={() => { setScope("all"); setChannel(""); }}>All channels</button>
            {scope === "africa" && channels && (
              <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel" style={{ fontFamily: "inherit", fontSize: 11, padding: "4px 6px", background: "#0b1422", color: text, border: "1px solid rgba(124,156,255,0.25)", borderRadius: 6, maxWidth: 190 }}>
                <option value="">Every channel</option>
                {channels.filter((c) => c.posts72h > 0).map((c) => (
                  <option key={c.handle} value={c.handle}>{c.name} ({c.posts72h >= 20 ? "20+" : c.posts72h})</option>
                ))}
              </select>
            )}
          </div>
          {!posts && !error && <div style={{ color: muted, fontSize: 11 }}>Loading posts…</div>}
          {posts && shown.length === 0 && (
            <div style={{ color: muted, fontSize: 11, lineHeight: 1.5 }}>
              No posts to show yet. {waiting > 0 ? "The channels are still being read for the first time; check again in a few minutes." : "Open the Channels tab to see what each channel returned."}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {shown.slice(0, 150).map((p) => (
              <a key={p.id} href={p.link} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none", padding: "8px 0", borderBottom: line }}>
                <div style={{ color: text, lineHeight: 1.4 }}>
                  {p.flag && <span style={{ color: "#ff6b6b", fontWeight: 700 }}>BREAKING · </span>}
                  {p.title}
                </div>
                {p.summary && <div style={{ color: muted, fontSize: 11, lineHeight: 1.45, marginTop: 3, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.summary}</div>}
                <div style={{ color: muted, fontSize: 10, marginTop: 3 }}>
                  <span style={{ color: "#9db4ff" }}>{p.source_name}</span>
                  {p.lean ? ` · ${p.lean}` : ""} · {ago(p.published)}
                  {p.also_reported_by.length > 0 ? ` · also on ${p.also_reported_by.map((s) => s.source_name).join(", ")}` : ""}
                </div>
              </a>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: muted, lineHeight: 1.45 }}>
            Telegram posts are unverified claims. On the map they appear as dashed, single-source pulses until a news outlet reports the same event.
          </div>
        </>
      )}

      {view === "channels" && (
        <>
          {!channels && !error && <div style={{ color: muted, fontSize: 11 }}>Loading channels…</div>}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {(channels ?? [])
              .slice()
              .sort((a, b) => b.posts72h - a.posts72h || a.name.localeCompare(b.name))
              .map((c) => {
                const state = !c.fetchedAt ? "waiting" : c.posts72h > 0 ? "live" : isQuiet(c.latest) ? "quiet" : "silent";
                const colour = state === "live" ? "#4dff9e" : state === "silent" ? "#ff8f8f" : "#ffd23f";
                return (
                  <div key={c.handle} style={{ padding: "8px 0", borderBottom: line }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <a href={`https://t.me/s/${c.handle}`} target="_blank" rel="noreferrer" style={{ color: text, textDecoration: "none", fontWeight: 600 }}>{c.name}</a>
                      <span style={{ color: colour, fontSize: 11, whiteSpace: "nowrap" }}>
                        {state === "live" ? `${c.posts72h >= 20 ? "20+" : c.posts72h} ${c.posts72h === 1 ? "post" : "posts"} in 72 h` : state === "quiet" ? "quiet" : state === "silent" ? "dead or closed" : "not read yet"}
                      </span>
                    </div>
                    <div style={{ color: muted, fontSize: 10.5, lineHeight: 1.45, marginTop: 2 }}>
                      @{c.handle} · {c.lean}
                      {c.lang !== "en" ? ` · ${c.lang.toUpperCase()}` : ""}
                    </div>
                    <div style={{ color: muted, fontSize: 10.5, lineHeight: 1.45 }}>
                      {c.fetchedAt ? `Last read ${ago(c.fetchedAt)}` : "Waiting for its first reading"}
                      {c.latest ? ` · newest post ${ago(c.latest)}` : ""}
                      {!c.seenInSearch ? " · handle not confirmed when added" : ""}
                    </div>
                    {state === "quiet" && <div style={{ color: "#ffd23f", fontSize: 10.5, lineHeight: 1.45 }}>Read without a problem; it has not posted in the last 72 hours.</div>}
                    {state === "silent" && <div style={{ color: "#ff8f8f", fontSize: 10.5, lineHeight: 1.45 }}>{c.status === "ok" ? "The channel exists but has not posted for more than a month." : c.status}</div>}
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
