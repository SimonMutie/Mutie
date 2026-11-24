import { useEffect, useState } from "react";
import { api, setToken, type AiProvider, type AiSettingsView, type AuthUser, type EscalationAuditEntry, type EscalationPipelineStatus, type MapTilerExtras, type Vehicle, TRACKING_URL } from "../api";
import AlertDeliveryPanel from "./AlertDeliveryPanel";
import { setMapTilerKey, setMaptilerExtras } from "../mapProvider";
import { REPLAY_EVENT, introSoundEnabled, setIntroSoundEnabled, introVoiceEnabled, setIntroVoiceEnabled } from "../intro";

interface Props {
  onBack: () => void;
  user: AuthUser;
}

/** Available to every authenticated user — platform admin or any client
 *  login, including a client's own teammates — not gated by role, unlike
 *  most of this app's other admin-facing panels. Currently just password
 *  change, but the container is deliberately named and structured to hold
 *  more personal-account settings later without needing a rework. */
export default function SettingsPanel({ onBack, user }: Props) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <button onClick={onBack} style={backBtnStyle}>
        ← Back
      </button>

      <div className="eyebrow" style={{ margin: "16px 0 14px" }}>
        SETTINGS
      </div>

      <ChangePasswordForm />

      <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Conflict escalation alerts</div>
        <AlertDeliveryPanel target={{ scope: "escalations" }} />
      </div>

      {user.role === "admin" && (
        <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Test the alert pop-up and sound</div>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginBottom: 10 }}>Sends a made-up alert to this browser only. Nothing is saved.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => api.sendTestAlert("elevated").catch(() => {})}>Send Elevated test</button>
            <button onClick={() => api.sendTestAlert("critical").catch(() => {})}>Send Critical test</button>
          </div>
        </div>
      )}

      <SignOutEverywhereCard />

      <CreditsCard />

      <OpeningSequenceCard />

      {user.role === "admin" && <MapProviderCard />}
      {user.role === "admin" && <MapTilerExtrasCard />}
      {user.role === "admin" && <VehiclesCard />}

      {user.role === "admin" && <AiReadingCard />}
      {user.role === "admin" && <AiUsageCard />}
    </div>
  );
}

/** Ends every session this login has, on every device. */
function SignOutEverywhereCard() {
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!window.confirm("Sign out on every device, including this one?")) return;
    setBusy(true);
    try {
      await api.logoutAll();
    } catch {
      /* the session may already be gone */
    }
    setToken(null);
    window.location.reload();
  }
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sign out everywhere</div>
      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)", margin: "8px 0 12px" }}>
        Use this after losing a device or signing in on a shared computer. Every session ends and you sign in again with your password.
      </p>
      <button onClick={go} disabled={busy} style={backBtnStyle}>
        {busy ? "Signing out…" : "Sign out on all devices"}
      </button>
    </div>
  );
}

/** Where the platform's data comes from, with the credits those sources ask for. */
function CreditsCard() {
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Data sources and use</div>
      <ul style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--text-muted)", margin: "8px 0 10px", paddingLeft: 18 }}>
        <li>Base maps © OpenStreetMap contributors; satellite imagery © Esri and its providers.</li>
        <li>Province boundaries: Natural Earth (public domain) and geoBoundaries (CC BY 4.0).</li>
        <li>Economic indicators: World Bank Open Data (CC BY 4.0).</li>
        <li>Event data: GDELT Project. News headlines link to their original publishers.</li>
        <li>Currency rates: European Central Bank via Frankfurter. Crypto prices: CoinGecko. Energy and interest rates: US Federal Reserve (FRED).</li>
        <li>Escalation assessments are produced with AI assistance from public reporting and can be wrong; check the linked sources before acting on them.</li>
      </ul>
      <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
        Afrilens Consulting analysis for the named client's internal use. Not to be resold or redistributed. Exports carry this notice.
      </div>
    </div>
  );
}

/** The opening sequence's sound, per browser, and a way to see it again. */
function OpeningSequenceCard() {
  const [sound, setSound] = useState(introSoundEnabled);
  const [voice, setVoice] = useState(introVoiceEnabled);
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 380 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Opening sequence</div>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)", margin: "8px 0 12px" }}>Plays once each time the site is opened. Click anywhere or press a key to skip it.</p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked);
            setIntroSoundEnabled(e.target.checked);
          }}
        />
        Play the opening tone on this browser
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 8, opacity: sound ? 1 : 0.5 }}>
        <input
          type="checkbox"
          checked={voice}
          disabled={!sound}
          onChange={(e) => {
            setVoice(e.target.checked);
            setIntroVoiceEnabled(e.target.checked);
          }}
        />
        Spoken welcome (British English, female voice)
      </label>
      <button type="button" onClick={() => window.dispatchEvent(new Event(REPLAY_EVENT))} style={{ ...backBtnStyle, marginTop: 12 }}>
        Play it now
      </button>
    </div>
  );
}

/** Platform admin only: what the platform's AI use is today, what could
 *  cost money, and whether the article reading behind escalation alerts is
 *  actually running — so none of that needs the Cloudflare dashboard. */
/** Platform admin: which AI reads for the Lens (Claude, Cloudflare's own AI, or Claude with Cloudflare as the
 *  fallback), the Claude models, the Anthropic key, and each one's daily limit (backend lib/aiSettings.ts). */
function AiReadingCard() {
  const [v, setV] = useState<AiSettingsView | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState("");
  const [neurons, setNeurons] = useState("");
  const [words, setWords] = useState("");
  const [collect, setCollect] = useState<{ busy: boolean; text: string; ok: boolean } | null>(null);
  async function collectNow() {
    setCollect({ busy: true, text: "Collecting… this takes up to a minute or two.", ok: true });
    try {
      const r = await api.collectNow();
      const run = r.run;
      if (!run) return setCollect({ busy: false, text: "No round has run yet.", ok: false });
      const read = run.coded + run.rejected;
      const who = run.provider === "anthropic" ? `Claude (${run.coderModel})` : "Cloudflare's AI";
      const text = [
        r.note ?? `Read ${read} article${read === 1 ? "" : "s"} with ${who}: ${run.coded} with reportable events (${run.reports} reports), ${run.rejected} not reportable.`,
        typeof run.headlineSkipped === "number" ? `${run.headlineSkipped} passed over by headline; ${run.fresh} new candidates in the feeds.` : "",
        run.lastModelError ? `Model error: ${run.lastModelError}` : "",
        run.aiBudgetReached ? "Today's AI limit is reached." : "",
        `Claude today: ${r.claude.calls} of ${r.claude.limit} calls.`,
        run.byCountry
          ? `By country this round: ${Object.entries(run.byCountry)
              .sort((a, b) => b[1].waiting + b[1].skipped - (a[1].waiting + a[1].skipped))
              .slice(0, 8)
              .map(([k, c]) => `${k === "?" ? "unplaced" : k} ${c.read} read / ${c.waiting} waiting / ${c.skipped} passed over`)
              .join("; ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      setCollect({ busy: false, text, ok: !run.lastModelError });
      const s = await api.getAiSettings();
      setV(s);
    } catch (e) {
      setCollect({ busy: false, text: e instanceof Error ? e.message : "Could not collect.", ok: false });
    }
  }
  useEffect(() => {
    api.getAiSettings().then(
      (s) => {
        setV(s);
        setLimit(String(s.claudeDailyCalls));
        setNeurons(s.cloudflareDailyNeurons === null ? "" : String(s.cloudflareDailyNeurons));
        setWords(s.extraKeywords ?? "");
      },
      (e: Error) => setMsg({ ok: false, text: e.message })
    );
  }, []);
  async function save(edit: Parameters<typeof api.setAiSettings>[0], done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.setAiSettings(edit);
      setV(s);
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }
  const choice = (p: AiProvider, title: string, text: string) => (
    <label key={p} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "7px 0", cursor: "pointer", fontSize: 13 }}>
      <input type="radio" name="ai-provider" checked={v?.provider === p} disabled={busy} onChange={() => save({ provider: p }, "Saved. It applies from the next article read.")} style={{ marginTop: 3 }} />
      <span>
        <b>{title}</b>
        <span style={{ display: "block", color: "var(--text-muted)", fontSize: 12.5 }}>{text}</span>
      </span>
    </label>
  );
  const modelSelect = (which: "coderModel" | "analystModel", label: string) => {
    const cur = v?.[which] ?? "";
    const known = v?.models.some((m) => m.id === cur);
    return (
      <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <select value={known ? cur : "__other"} disabled={busy || v?.modelsFromEnv} onChange={(e) => e.target.value !== "__other" && save({ [which]: e.target.value }, "Model saved.")}>
          {v?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          {!known && <option value="__other">{cur}</option>}
        </select>
      </label>
    );
  };
  const u = v?.usage;
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>AI reading</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 8 }}>
        Which AI reads articles for escalation alerts, writes incident assessments and summaries. Claude reads more thoroughly; Cloudflare's own AI is the free fallback.
      </div>
      {!v && !msg && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>}
      {v && (
        <>
          {choice("auto", "Automatic (recommended)", "Claude reads; if Claude is unavailable, fails or reaches today's limit, Cloudflare's AI carries on.")}
          {choice("claude", "Claude only", "Only Claude reads. Reading pauses once today's Claude limit is reached.")}
          {choice("cloudflare", "Cloudflare only", "Only Cloudflare's AI reads, within its daily allowance. Claude is never called.")}

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>Anthropic key (for Claude)</div>
          <div style={{ fontSize: 12.5, color: v.keySet ? "var(--positive)" : "var(--text-muted)", marginBottom: 6 }}>
            {v.keySet ? `Set (ends …${v.keyHint})${v.keyFromEnv ? ", as a Worker secret" : ""}.` : "Not set: Claude is not used until a key is added."}
          </div>
          {!v.keyFromEnv && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="sk-ant-…" style={{ flex: "1 1 240px" }} aria-label="Anthropic API key" autoComplete="off" />
              <button disabled={busy || !key} onClick={() => save({ anthropicKey: key }, "Key checked with Anthropic and saved.").then(() => setKey(""))}>
                {v.keySet ? "Replace" : "Save"}
              </button>
              {v.keySet && (
                <button disabled={busy} onClick={() => window.confirm("Remove the Anthropic key? Reading moves to Cloudflare's AI.") && save({ anthropicKey: null }, "Key removed.")}>
                  Remove
                </button>
              )}
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>Claude models</div>
          <div style={{ display: "grid", gap: 8 }}>
            {modelSelect("coderModel", "Reads each article")}
            {modelSelect("analystModel", "Writes incident assessments and summaries")}
          </div>
          {v.modelsFromEnv && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Set in the Worker's settings, which take precedence.</div>}

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>Daily limits</div>
          <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 220px", color: "var(--text-muted)" }}>Claude: most calls a day (about one per article read)</span>
              <input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 100 }} />
              <button disabled={busy || limit === String(v.claudeDailyCalls)} onClick={() => save({ claudeDailyCalls: Math.max(0, Math.round(Number(limit) || 0)) }, "Claude limit saved.")}>
                Save
              </button>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 220px", color: "var(--text-muted)" }}>Cloudflare: daily allowance in neurons (blank for the free 10,000; above that Cloudflare bills)</span>
              <input type="number" min={0} value={neurons} placeholder="free" onChange={(e) => setNeurons(e.target.value)} style={{ width: 100 }} />
              <button
                disabled={busy || neurons === (v.cloudflareDailyNeurons === null ? "" : String(v.cloudflareDailyNeurons))}
                onClick={() => {
                  const n = neurons.trim() === "" ? null : Math.max(0, Math.round(Number(neurons) || 0));
                  if (n !== null && n > 10_000 && !window.confirm("Above 10,000 neurons a day, Cloudflare bills the extra. Save?")) return;
                  void save({ cloudflareDailyNeurons: n }, "Cloudflare allowance saved.");
                }}
              >
                Save
              </button>
            </label>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>Headline words</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 6 }}>
            Only articles whose headline is about conflict, security, crime, intercommunal violence or killing are read in full. The built-in word lists cover English, French, Portuguese, Arabic, Amharic, Tigrinya, Oromo, Somali, Swahili, Hausa, Kinyarwanda and Lingala. Add any word or phrase that should also let a headline through, one per line; each also matches longer words that start with it.
          </div>
          <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={4} placeholder={"e.g.\nboda boda\nwananchi wavamia"} style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 12.5 }} />
          <button disabled={busy || words === (v.extraKeywords ?? "")} onClick={() => save({ extraKeywords: words }, "Headline words saved; they apply from the next run.")} style={{ marginTop: 6 }}>
            Save words
          </button>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button disabled={busy || collect?.busy} onClick={collectNow} style={{ fontWeight: 600 }}>
              {collect?.busy ? "Collecting…" : "Collect now"}
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Runs a reading round straight away (otherwise every five minutes).</span>
          </div>
          {collect && <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5, color: collect.ok ? "var(--positive)" : "var(--critical)" }}>{collect.text}</div>}
          <CountryCheck />

          {u && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {u.claude.byFeature && u.claude.byFeature.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  Claude today by use:{" "}
                  {u.claude.byFeature.map((f) => `${f.feature} ${f.calls.toLocaleString()} calls (${Math.round((f.inputTokens + f.outputTokens) / 1000).toLocaleString()}k tokens)`).join(" · ")}
                </div>
              )}
              Today (UTC): Claude {u.claude.calls.toLocaleString()} of {u.claude.limit.toLocaleString()} calls, {(u.claude.inputTokens + u.claude.cacheReadTokens + u.claude.cacheWriteTokens).toLocaleString()} tokens in and {u.claude.outputTokens.toLocaleString()} out · Cloudflare {u.cloudflare.used.toLocaleString()} of {u.cloudflare.budget.toLocaleString()} neurons.
              {(u.claude.failedCalls ?? 0) > 0 && (
                <div style={{ marginTop: 4, color: "var(--elevated)" }}>
                  Claude refused {u.claude.failedCalls!.toLocaleString()} call{u.claude.failedCalls === 1 ? "" : "s"} today (not billed, not counted above).
                  {u.claude.lastError && ` Last error${u.claude.lastErrorAt ? ` at ${new Date(u.claude.lastErrorAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}: ${u.claude.lastError}`}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.ok ? "var(--positive)" : "var(--critical)" }}>{msg.text}</div>}
    </div>
  );
}

/** Why a country shows nothing: every article about it the pipeline has decided on, newest first, with the reason. */
function CountryCheck() {
  const [country, setCountry] = useState("Ethiopia");
  const [items, setItems] = useState<EscalationAuditEntry[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.getEscalationAudit({ country, limit: 60 });
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not check.");
    } finally {
      setBusy(false);
    }
  }
  const counts = items ? items.reduce<Record<string, number>>((m, i) => ((m[i.status] = (m[i.status] ?? 0) + 1), m), {}) : null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Check a country</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={country} onChange={(e) => setCountry(e.target.value)} style={{ flex: 1 }} aria-label="Country" />
        <button disabled={busy || !country.trim()} onClick={check}>
          {busy ? "Checking…" : "Check"}
        </button>
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--critical)", marginTop: 6 }}>{err}</div>}
      {items && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
            {items.length === 0
              ? `Nothing about ${country} has been read yet.`
              : `Last ${items.length} read: ${Object.entries(counts!)
                  .map(([k, n]) => `${n} ${k === "coded" ? "with events" : k}`)
                  .join(", ")}.`}
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 6 }}>
            {items.map((i) => (
              <div key={i.url + i.processedAt} style={{ borderLeft: `3px solid ${i.status === "coded" ? "var(--positive)" : i.status === "rejected" ? "var(--warning, #c9a227)" : "var(--critical)"}`, paddingLeft: 8 }}>
                <a href={i.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>
                  {i.title || i.url}
                </a>
                <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                  {i.domain} · {new Date(i.processedAt).toLocaleString()} · <b>{i.status === "coded" ? `coded: ${i.reports.map((r) => `${r.location ?? r.country} (${r.indicators.join(", ")})`).join("; ")}` : i.status}</b>
                  {i.rejectionReason ? ` · ${i.rejectionReason.replace(/_/g, " ")}` : ""}
                  {i.rejectionNote ? ` — ${i.rejectionNote}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AiUsageCard() {
  const [status, setStatus] = useState<EscalationPipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getEscalationStatus()
        .then((s) => !cancelled && (setStatus(s), setError(null)))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the status."));
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const row = (label: string, value: React.ReactNode, tone?: "ok" | "warn") => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "7px 0", borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ textAlign: "right", fontWeight: 600, color: tone === "ok" ? "var(--positive)" : tone === "warn" ? "var(--elevated)" : "var(--text-primary)" }}>{value}</span>
    </div>
  );

  const ai = status?.ai;
  const count = (name: string) => status?.last24h.find((s) => s.status === name)?.count ?? 0;
  const lastRun = status?.lastRun as { at?: string; aiBudgetReached?: boolean; lastModelError?: { message?: string; provider?: string } | null; } | null | undefined;
  const free = !!ai && ai.budget <= ai.freeAllowance && !status?.paidModelKeySet;
  const lastRunAge = lastRun?.at ? Math.round((Date.now() - Date.parse(lastRun.at)) / 60_000) : null;

  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>AI use and costs</div>
      {error && <div style={{ fontSize: 12.5, color: "var(--critical)", marginTop: 8 }}>{error}</div>}
      {!status && !error && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>Loading…</div>}
      {status && (
        <>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)", margin: "8px 0 12px" }}>
            {free
              ? "The platform's AI use is held inside Cloudflare's free daily allowance. When today's limit is reached it stops calling the AI until the allowance resets, so it cannot produce an AI charge."
              : "The settings below allow AI use that is billed. See the lines marked in amber."}
          </p>
          {ai &&
            row(
              "AI used today",
              `${ai.used.toLocaleString()} of ${ai.budget.toLocaleString()} (free allowance ${ai.freeAllowance.toLocaleString()})`,
              ai.budget <= ai.freeAllowance ? "ok" : "warn"
            )}
          {ai && row("Resets", "03:00 Nairobi time (00:00 UTC)")}
          {row("Paid AI key", status.paidModelKeySet ? "Set: article reading is billed by Anthropic" : "Not set", status.paidModelKeySet ? "warn" : "ok")}
          {row("Translation", status.translationEnabled ? "On (counted within the daily limit)" : "Off", "ok")}
          <div style={{ fontSize: 13.5, fontWeight: 600, margin: "18px 0 6px" }}>Article reading for escalation alerts</div>
          {row("Last run", lastRunAge === null ? "Never" : lastRunAge <= 1 ? "Just now" : `${lastRunAge} minutes ago`, lastRunAge !== null && lastRunAge <= 15 ? "ok" : "warn")}
          {status.headlineTierEnabled !== false && row("Picked up from headlines, last 24 hours", `${status.headline24h ?? 0} reports (no AI used)`)}
          {row("Read in full, last 24 hours", `${count("coded") + count("rejected")} articles (${count("coded")} with reportable events)`)}
          {typeof (lastRun as { headlineSkipped?: number } | null | undefined)?.headlineSkipped === "number" && row("Passed over by headline, last run", `${(lastRun as { headlineSkipped: number }).headlineSkipped} more (most off-topic headlines are already dropped when the feeds are collected; not read)`)}
          {row("Could not be opened", String(count("unreadable")))}
          {row("Failed", String(count("error")), count("error") > 0 ? "warn" : undefined)}
          {lastRun?.aiBudgetReached && row("Today", "Daily AI limit reached. Reading resumes after the reset.", "warn")}
          {lastRun?.lastModelError?.message && row("Last AI error", `${lastRun.lastModelError.provider ?? "model"}: ${lastRun.lastModelError.message}`, "warn")}
        </>
      )}
    </div>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 12) {
      setError("New password needs to be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password needs to be different from your current one.");
      return;
    }

    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      reset();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change your password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 380 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Change password</div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        Current password
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            setSuccess(false);
          }}
          autoComplete="current-password"
          style={inputStyle}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        New password
        <input
          type="password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setSuccess(false);
          }}
          autoComplete="new-password"
          style={inputStyle}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        Confirm new password
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setSuccess(false);
          }}
          autoComplete="new-password"
          style={inputStyle}
        />
      </label>

      {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
      {success && <div style={{ color: "var(--signal)", fontSize: 12 }}>Password changed.</div>}

      <button type="submit" disabled={submitting || !currentPassword || !newPassword || !confirmPassword} style={{ ...primaryBtnStyle, marginTop: 4 }}>
        {submitting ? "Changing…" : "Change password"}
      </button>
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

/** Platform admin: the MapTiler key for the better basemaps, kept in the database (never in the public code). */
function MapProviderCard() {
  const [current, setCurrent] = useState<{ maptiler: string | null; fromEnv: boolean; updatedAt: string | null } | null>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.getMapProvider().then(setCurrent).catch(() => setCurrent(null));
  }, []);

  /** Loads one MapTiler tile with the key, which proves the key works from this site. */
  const check = (key: string) =>
    new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = `https://api.maptiler.com/maps/streets-v2/256/2/2/1.png?key=${encodeURIComponent(key)}`;
    });

  async function save(next: string | null) {
    setBusy(true);
    setStatus(null);
    try {
      if (next && !(await check(next))) {
        setStatus({ ok: false, text: "MapTiler refused this key from this site. Check the key, and that this site's address is allowed in the key's settings on MapTiler." });
        return;
      }
      await api.setMapProvider(next);
      setMapTilerKey(next);
      setCurrent({ maptiler: next, fromEnv: false, updatedAt: new Date().toISOString() });
      setValue("");
      setStatus({ ok: true, text: next ? "Saved. The MapTiler maps are on for everyone; open maps reload with them." : "Removed. The maps are back to the free basemaps." });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  const masked = current?.maptiler ? `${current.maptiler.slice(0, 4)}…${current.maptiler.slice(-3)}` : null;
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Maps (MapTiler)</div>
      <div style={{ fontSize: 12.5, opacity: 0.75, marginBottom: 10, lineHeight: 1.5 }}>
        With a MapTiler key, every map in the Lens uses MapTiler's basemaps (Lens, Dark, Streets, Satellite, Outdoor, Topographic, Ocean, Landscape, Muted, Data, Toner), and the globe gets terrain, weather, sea-floor depth, land cover, place search and routing. In MapTiler, restrict the key to this site's address so it cannot be used anywhere else.
      </div>
      <div style={{ fontSize: 12.5, marginBottom: 10 }}>
        {masked ? (
          <>
            Key in use: <code>{masked}</code>
            {current?.fromEnv ? " (set on the server)" : current?.updatedAt ? `, saved ${new Date(current.updatedAt).toLocaleDateString()}` : ""}
          </>
        ) : (
          "No key set: the maps use the free basemaps."
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={value} onChange={(e) => setValue(e.target.value.trim())} placeholder="Paste the MapTiler API key" style={{ flex: "1 1 240px" }} aria-label="MapTiler API key" />
        <button disabled={busy || !value} onClick={() => void save(value)}>
          {busy ? "Checking…" : "Save key"}
        </button>
        {current?.maptiler && !current.fromEnv && (
          <button disabled={busy} onClick={() => void save(null)}>
            Remove
          </button>
        )}
      </div>
      {status && <div style={{ fontSize: 12.5, marginTop: 8, color: status.ok ? "var(--positive)" : "var(--negative, #f87171)" }}>{status.text}</div>}
    </div>
  );
}

/** The admin's own MapTiler content: a custom map style used as the "Lens" basemap, and uploaded datasets shown as
 *  layers on Live OSINT. Both are made in the MapTiler account; only their ids are entered here. */
function MapTilerExtrasCard() {
  const [extras, setExtras] = useState<MapTilerExtras>({ customStyle: null, datasets: [] });
  const [styleId, setStyleId] = useState("");
  const [ds, setDs] = useState({ id: "", label: "", color: "#f5a524" });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.getMapExtras().then((x) => {
      setExtras(x);
      setStyleId(x.customStyle?.id ?? "");
    }).catch(() => undefined);
  }, []);
  async function save(next: MapTilerExtras, done: string) {
    setBusy(true);
    setStatus(null);
    try {
      const saved = await api.setMapExtras(next);
      setExtras(saved);
      setMaptilerExtras(saved);
      setStatus({ ok: true, text: done });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }
  /** The id part of a pasted MapTiler link or id. */
  const idOf = (v: string) => v.trim().replace(/^.*\/(maps|data)\//, "").replace(/[/?#].*$/, "");
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Your MapTiler map and data</div>
      <div style={{ fontSize: 12.5, opacity: 0.75, marginBottom: 12, lineHeight: 1.5 }}>
        Design your own map in MapTiler (Maps, New map, then style it) and paste its id or link here: it becomes the Lens basemap in Live OSINT. Upload your own layers (GeoJSON, KML, GPX or shapefile) in MapTiler's Data section and add each one here: they can then be shown on both views of Live OSINT.
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Lens basemap</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <input value={styleId} onChange={(e) => setStyleId(e.target.value)} placeholder="MapTiler map id or link" style={{ flex: "1 1 240px" }} aria-label="MapTiler map id" />
        <button disabled={busy || !idOf(styleId)} onClick={() => void save({ ...extras, customStyle: { id: idOf(styleId), label: "Lens" } }, "Saved. Choose the Lens basemap in Live OSINT to see it (reload open pages).")}>
          Save map
        </button>
        {extras.customStyle && (
          <button disabled={busy} onClick={() => void save({ ...extras, customStyle: null }, "Removed. The Lens basemap is back to the built-in quiet dark map.")}>
            Use built-in
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 14 }}>{extras.customStyle ? `In use: ${extras.customStyle.id}` : "None: the Lens basemap is a quiet dark map with Africa and the Middle East in focus."}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Datasets</div>
      {extras.datasets.length === 0 && <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>None yet.</div>}
      {extras.datasets.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: d.color, flex: "none" }} />
          <span style={{ flex: 1 }}>
            {d.label} <span style={{ opacity: 0.6 }}>({d.id})</span>
          </span>
          <button disabled={busy} onClick={() => void save({ ...extras, datasets: extras.datasets.filter((x) => x.id !== d.id) }, `Removed ${d.label}.`)}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <input value={ds.label} onChange={(e) => setDs({ ...ds, label: e.target.value })} placeholder="Name (e.g. Field offices)" style={{ flex: "1 1 150px" }} aria-label="Dataset name" />
        <input value={ds.id} onChange={(e) => setDs({ ...ds, id: e.target.value })} placeholder="Dataset id or link" style={{ flex: "1 1 180px" }} aria-label="Dataset id" />
        <input type="color" value={ds.color} onChange={(e) => setDs({ ...ds, color: e.target.value })} aria-label="Colour" style={{ width: 40, padding: 0 }} />
        <button
          disabled={busy || !idOf(ds.id) || !ds.label.trim() || extras.datasets.some((x) => x.id === idOf(ds.id))}
          onClick={() => {
            const next = { ...extras, datasets: [...extras.datasets, { id: idOf(ds.id), label: ds.label.trim(), color: ds.color }] };
            void save(next, `Added ${ds.label.trim()}. Show it from the map picker in Live OSINT (reload open pages).`).then(() => setDs({ id: "", label: "", color: "#f5a524" }));
          }}
        >
          Add
        </button>
      </div>
      {status && <div style={{ fontSize: 12.5, marginTop: 8, color: status.ok ? "var(--positive)" : "var(--negative, #f87171)" }}>{status.text}</div>}
    </div>
  );
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Vehicles tracked on Live OSINT: add one, get its token, and set up the phone or tracker that reports for it. */
function VehiclesCard() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#22c55e");
  const [limit, setLimit] = useState("");
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Awaited<ReturnType<typeof api.getTrackingLog>>["log"]>([]);
  const [showLog, setShowLog] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [positions, setPositions] = useState<string | null>(null);
  const load = () =>
    Promise.all([api.getVehicles().then((r) => setVehicles(r.vehicles)), api.getTrackingLog().then((r) => setLog(r.log))]).catch(() => undefined);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }
  const copy = (t: string) => void navigator.clipboard?.writeText(t);
  return (
    <div className="panel" style={{ padding: "18px 20px", marginTop: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Vehicles</div>
      <div style={{ fontSize: 12.5, opacity: 0.75, marginBottom: 12, lineHeight: 1.5 }}>
        Track vehicles on Live OSINT. Add a vehicle to get its secret token, then put the token in the phone app or tracker that rides in it. Positions are kept for 90 days and seen only by admins.
      </div>
      {vehicles.map((v) => {
        const fresh = v.last && Date.now() - Date.parse(v.last.at) < 10 * 60000;
        return (
          <div key={v.id} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 6, background: v.color, flex: "none" }} />
            <span style={{ flex: 1 }}>
              <b>{v.name}</b>{" "}
              <span style={{ opacity: 0.7 }}>
                {v.last ? `${fresh ? "reporting" : "last seen"} ${ago(v.last.at)}${v.last.speedKmh !== null ? `, ${Math.round(v.last.speedKmh)} km/h` : ""}` : "no position yet"}
              </span>
            </span>
            <button disabled={busy} onClick={() => setPositions(positions === v.id ? null : v.id)} aria-expanded={positions === v.id}>
              Positions
            </button>
            <button disabled={busy} onClick={() => setEditing(editing === v.id ? null : v.id)} aria-expanded={editing === v.id}>
              Alerts{v.speedLimitKmh || v.zone || v.quietHours || v.silentMinutes ? " ●" : ""}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (!window.confirm(`Make a new token for ${v.name}? The phone or tracker will stop reporting until you enter the new one.`)) return;
                  const r = await api.newVehicleToken(v.id);
                  setShown({ name: v.name, token: r.token });
                })
              }
            >
              New token
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (!window.confirm(`Remove ${v.name} and all its positions?`)) return;
                  await api.deleteVehicle(v.id);
                })
              }
            >
              Remove
            </button>
          </div>
          {editing === v.id && <VehicleRulesEditor vehicle={v} onSaved={() => void load()} />}
          {positions === v.id && <VehiclePositions vehicle={v} />}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vehicle name (e.g. Land Cruiser KDA 123X)" style={{ flex: "1 1 220px" }} aria-label="Vehicle name" />
        <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} placeholder="Speed limit km/h" style={{ width: 120 }} aria-label="Speed limit" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour" style={{ width: 40, padding: 0 }} />
        <button
          disabled={busy || !name.trim()}
          onClick={() =>
            void act(async () => {
              const r = await api.addVehicle({ name: name.trim(), color, speedLimitKmh: limit ? Number(limit) : null });
              setShown({ name: r.vehicle.name, token: r.token });
              setName("");
              setLimit("");
            })
          }
        >
          Add vehicle
        </button>
      </div>
      {shown && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, border: "1px solid var(--border, rgba(127,127,127,0.3))", fontSize: 12.5, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Set up the phone for {shown.name}</div>
          <div style={{ color: "var(--negative, #f87171)", marginBottom: 8 }}>Copy the token now: it is shown only once.</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Install <b>Traccar Client</b> (free, Android or iPhone) on the phone that will ride in the vehicle.</li>
            <li>
              Set <b>Device identifier</b> to the token: <code style={{ wordBreak: "break-all" }}>{shown.token}</code> <button onClick={() => copy(shown.token)}>Copy</button>
            </li>
            <li>
              Set <b>Server URL</b> to: <code style={{ wordBreak: "break-all" }}>{TRACKING_URL}</code> <button onClick={() => copy(TRACKING_URL)}>Copy</button>
            </li>
            <li>Set <b>Location accuracy</b> to <b>High</b>, <b>Frequency</b> to 10 seconds, <b>Distance</b> to 0 and <b>Angle</b> to 30, so the car's position is the phone's satellite fix, sent as it changes.</li>
            <li>Allow location <b>all the time</b>, and turn off battery saving for the app, so it keeps reporting with the screen off.</li>
            <li>Switch <b>Tracking</b> on. The vehicle appears on Live OSINT within a minute.</li>
          </ol>
          <button style={{ marginTop: 8 }} onClick={() => setShown(null)}>
            Done
          </button>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <button onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide" : "Show"} reports received ({log.length})</button>
        {showLog && (
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
            {log.length === 0 ? (
              <div style={{ opacity: 0.75 }}>
                Nothing has reached the Lens yet. Check the phone app's Server URL is exactly <code style={{ wordBreak: "break-all" }}>{TRACKING_URL}</code>, that Tracking is switched on, that location is allowed all the time, and that the phone has mobile data.
              </div>
            ) : (
              log.map((l, i) => (
                <div key={i} style={{ padding: "5px 0", borderTop: i ? "1px solid var(--border, rgba(127,127,127,0.2))" : undefined }}>
                  <div>
                    <b style={{ color: l.outcome.startsWith("Saved") ? "var(--positive)" : "var(--negative, #f87171)" }}>{l.outcome}</b> <span style={{ opacity: 0.65 }}>{ago(l.at)} · device {l.device}</span>
                  </div>
                  {l.sample && <code style={{ display: "block", opacity: 0.7, wordBreak: "break-all", fontSize: 11 }}>{l.method} {l.contentType} {l.sample}</code>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {status && <div style={{ fontSize: 12.5, marginTop: 8, color: status.ok ? "var(--positive)" : "var(--negative, #f87171)" }}>{status.text}</div>}
    </div>
  );
}

/** One vehicle's alert rules: each pops up with a sound on Live OSINT when broken. */
function VehicleRulesEditor({ vehicle, onSaved }: { vehicle: Vehicle; onSaved: () => void }) {
  const [limit, setLimit] = useState(vehicle.speedLimitKmh ? String(vehicle.speedLimitKmh) : "");
  const [zone, setZone] = useState(vehicle.zone);
  const [radius, setRadius] = useState(String(vehicle.zone?.radiusM ?? 300));
  const [quiet, setQuiet] = useState(vehicle.quietHours);
  const [silent, setSilent] = useState(vehicle.silentMinutes ?? 0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const precise = vehicle.last && (vehicle.last.accuracyM === null || vehicle.last.accuracyM <= 60);
  async function save() {
    setMsg(null);
    try {
      const r = Number(radius);
      await api.updateVehicle(vehicle.id, {
        speedLimitKmh: limit ? Number(limit) : null,
        zone: zone ? { ...zone, radiusM: Number.isFinite(r) && r >= 50 ? r : 300 } : null,
        quietHours: quiet,
        silentMinutes: silent || null,
      });
      setMsg({ ok: true, text: "Saved. Broken rules now pop up with a sound on Live OSINT." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    }
  }
  const row = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const, marginBottom: 8 };
  return (
    <div style={{ margin: "8px 0 4px 20px", padding: 12, borderRadius: 8, border: "1px solid var(--border, rgba(127,127,127,0.3))", fontSize: 12.5 }}>
      <div style={row}>
        <span style={{ width: 150 }}>Speed limit</span>
        <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} placeholder="Off" style={{ width: 80 }} aria-label="Speed limit km/h" /> km/h
      </div>
      <div style={row}>
        <span style={{ width: 150 }}>Safe zone</span>
        {zone ? (
          <>
            <span style={{ opacity: 0.8 }}>
              {zone.lat.toFixed(5)}, {zone.lng.toFixed(5)}
            </span>
            radius <input value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ""))} style={{ width: 70 }} aria-label="Zone radius metres" /> m
            <button onClick={() => setZone(null)}>Remove</button>
          </>
        ) : (
          <button
            disabled={!vehicle.last}
            onClick={() => vehicle.last && setZone({ lat: vehicle.last.lat, lng: vehicle.last.lng, radiusM: Number(radius) || 300 })}
            title={vehicle.last ? "" : "The vehicle has not reported yet"}
          >
            Centre on the car's position now
          </button>
        )}
      </div>
      {!zone && vehicle.last && !precise && <div style={{ fontSize: 11.5, color: "var(--negative, #f87171)", margin: "-4px 0 8px 158px" }}>The car's last position is rough (±{Math.round(vehicle.last.accuracyM ?? 0)} m). Set the zone once the phone has a satellite fix, outdoors.</div>}
      <div style={row}>
        <span style={{ width: 150 }}>Quiet hours (Nairobi)</span>
        <select value={quiet ? quiet.from : -1} onChange={(e) => setQuiet(Number(e.target.value) < 0 ? null : { from: Number(e.target.value), to: quiet?.to ?? 5 })} aria-label="Quiet hours from">
          <option value={-1}>Off</option>
          {hours.map((h) => (
            <option key={h} value={h}>
              {hh(h)}
            </option>
          ))}
        </select>
        {quiet && (
          <>
            to
            <select value={quiet.to} onChange={(e) => setQuiet({ ...quiet, to: Number(e.target.value) })} aria-label="Quiet hours to">
              {hours.map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div style={row}>
        <span style={{ width: 150 }}>Not reporting for</span>
        <select value={silent} onChange={(e) => setSilent(Number(e.target.value))} aria-label="Not reporting alert">
          <option value={0}>Off</option>
          {[15, 30, 60, 120, 360, 720, 1440].map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} minutes` : m < 1440 ? `${m / 60} hours` : "1 day"}
            </option>
          ))}
        </select>
      </div>
      <button onClick={() => void save()}>Save alerts</button>
      {msg && <div style={{ marginTop: 6, color: msg.ok ? "var(--positive)" : "var(--negative, #f87171)" }}>{msg.text}</div>}
    </div>
  );
}

/** The last 30 fixes exactly as the phone sent them, with their precision and distance from where the car is drawn. */
function VehiclePositions({ vehicle }: { vehicle: Vehicle }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getVehicleRecent>> | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api.getVehicleRecent(vehicle.id).then((d) => live && setData(d)).catch(() => undefined);
    void load();
    const t = window.setInterval(load, 10000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [vehicle.id]);
  const m = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    const r = Math.PI / 180;
    const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  };
  if (!data) return <div style={{ margin: "8px 0 4px 20px", fontSize: 12 }}>Loading…</div>;
  const shown = data.shown;
  const rough = data.points.filter((p) => p.accuracyM !== null && p.accuracyM > 30).length;
  const text = data.points.map((p) => `${p.at}\t${p.lat.toFixed(6)}\t${p.lng.toFixed(6)}\t±${p.accuracyM ?? "?"} m\t${p.speedKmh === null ? "" : Math.round(p.speedKmh) + " km/h"}`).join("\n");
  return (
    <div style={{ margin: "8px 0 4px 20px", padding: 12, borderRadius: 8, border: "1px solid var(--border, rgba(127,127,127,0.3))", fontSize: 12 }}>
      {shown && (
        <div style={{ marginBottom: 8 }}>
          Drawn at <b>{shown.lat.toFixed(6)}, {shown.lng.toFixed(6)}</b>
          {shown.accuracyM !== null ? ` (±${Math.round(shown.accuracyM)} m)` : ""}.{" "}
          <a href={`https://www.google.com/maps?q=${shown.lat},${shown.lng}`} target="_blank" rel="noreferrer">
            Check in Google Maps
          </a>
        </div>
      )}
      {data.points.length > 0 && (
        <div style={{ marginBottom: 8, color: rough > data.points.length / 2 ? "var(--negative, #f87171)" : undefined }}>
          {rough} of the last {data.points.length} fixes were rough (worse than ±30 m)
          {rough > data.points.length / 2 ? ": the phone is not getting a satellite fix. Put it where it sees the sky (dashboard, by the windscreen) and set Location accuracy to High." : "."}
        </div>
      )}
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.7 }}>
              <th>Time</th>
              <th>Position sent</th>
              <th>Precision</th>
              <th>Speed</th>
              <th>From drawn</th>
            </tr>
          </thead>
          <tbody>
            {data.points.map((p) => {
              const bad = p.accuracyM !== null && p.accuracyM > 30;
              return (
                <tr key={p.at} style={{ color: bad ? "var(--negative, #f87171)" : undefined }}>
                  <td>{new Date(p.at).toLocaleTimeString()}</td>
                  <td>
                    {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
                  </td>
                  <td>{p.accuracyM === null ? "not sent" : `±${Math.round(p.accuracyM)} m`}</td>
                  <td>{p.speedKmh === null ? "" : `${Math.round(p.speedKmh)} km/h`}</td>
                  <td>{shown ? `${Math.round(m(shown.lat, shown.lng, p.lat, p.lng))} m` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(text)}>
        Copy these positions
      </button>
    </div>
  );
}
