import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import type { Env } from "../bindings";
import { callStructured } from "./llm";
import { countTop } from "./daySummary";
import { getFlaggedIncidents, type IncidentView } from "../escalationIncidents";
import { channelsAvailable, sendNotification, type Channel, type Notification, type NotificationLink, type NotificationSection } from "./notify";

/**
 * Alert subscriptions: a person asks to be told, by email or Signal, about
 * new developments in one of their monitoring queries or in the general
 * Conflict Escalation feed. Each message says what changed, gives an
 * interpretive reading, and links the reports behind it.
 *
 *   • Escalation feed — driven by the incident pipeline (escalationIncidents.ts).
 *     An incident is announced when it first appears at or above the
 *     subscriber's level, when it is raised to a higher level, and when
 *     several new reports have joined it since the last message. The text
 *     comes from the incident's own analyst-written assessment, so no extra
 *     AI call is made.
 *   • Query — new matches since the last message, summarised and read by
 *     the analyst model (falling back to a plain digest when no AI is
 *     available, which the message says), at most once per chosen interval.
 *
 * Runs on the 5-minute cron right after the escalation pipeline. A message
 * is only counted as delivered — and its incidents/matches only marked as
 * told — once the channel accepted it; a failed send is retried next tick.
 */

export type Scope = "query" | "escalations";
/** Escalation feed: "elevated" | "critical". Query: "any" (every new
 *  development) or "alert" (only once an alert has opened for the query —
 *  today a coverage surge, see queryWatch.ts). */
export type MinLevel = "any" | "alert" | "elevated" | "critical";

export const FREQUENCIES = [15, 60, 360, 1440] as const;
export const DEFAULT_FREQUENCY: Record<Scope, number> = { query: 60, escalations: 15 };
const LEVEL_RANK: Record<string, number> = { any: 0, alert: 0, info: 0, elevated: 1, critical: 2 };
/** Reports that must join a known incident before it is announced again. */
const UPDATE_REPORT_STEP = 3;
const MAX_SECTIONS = 5;
const MAX_AI_PER_RUN = 5;
const QUERY_LOOKBACK_HOURS = 24;
const MODEL_ITEMS = 24;

export interface Subscription {
  id: string;
  owner_id: string;
  scope: Scope;
  query_id: string | null;
  channel: Channel;
  destination: string;
  min_level: MinLevel;
  frequency_minutes: number;
  enabled: number;
  cursor_at: string | null;
  last_sent_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
}

// ── Schema ───────────────────────────────────────────────────────────────

let tablesReady = false;
export function resetAlertTableCheck(): void {
  tablesReady = false;
}
export async function ensureAlertTables(env: Env): Promise<void> {
  if (tablesReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS alert_subscriptions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      query_id TEXT,
      channel TEXT NOT NULL,
      destination TEXT NOT NULL,
      min_level TEXT NOT NULL DEFAULT 'any',
      frequency_minutes INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      cursor_at TEXT,
      last_sent_at TEXT,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_owner ON alert_subscriptions (owner_id, scope, query_id)`,
    // What each escalation subscriber has already been told, per incident.
    `CREATE TABLE IF NOT EXISTS alert_subscription_seen (
      subscription_id TEXT NOT NULL,
      incident_id TEXT NOT NULL,
      level TEXT NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (subscription_id, incident_id)
    )`,
  ];
  for (const sql of stmts) await env.DB.prepare(sql).run();
  tablesReady = true;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const tidy = (s: string) => s.replace(/\s*\[\d+\]/g, "").replace(/\s+/g, " ").trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ── Escalation feed ──────────────────────────────────────────────────────

type ChangeKind = "new" | "escalated" | "updated";
interface Change {
  incident: IncidentView;
  kind: ChangeKind;
  prevLevel?: string;
  newReports?: number;
}

function incidentSection(c: Change): NotificationSection {
  const i = c.incident;
  const place = i.locationLabel ? `${i.locationLabel}, ${i.countryName}` : i.countryName;
  const headline = i.headline.replace(/\.$/, "");
  const changed =
    c.kind === "new"
      ? `New ${i.level} escalation. ${headline}.${i.summary ? ` ${i.summary}` : ""}`
      : c.kind === "escalated"
        ? `Raised from ${c.prevLevel} to ${i.level}. ${headline}.${i.summary ? ` ${i.summary}` : ""}`
        : `${c.newReports} more report${c.newReports === 1 ? "" : "s"} since the last alert (${i.reportCount} in all). ${headline}.`;
  const analysis = [
    i.assessment,
    i.outlook ? `Outlook: ${i.outlook}` : "",
    i.caveats ? `Caveat: ${i.caveats}` : "",
    i.preliminary ? "Preliminary: so far known only from headlines; no article behind it has been read in full." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const links: NotificationLink[] = i.sources.slice(0, 5).map((s) => ({ title: s.title ?? s.domain, url: s.url, source: s.domain }));
  return { heading: `${i.level.toUpperCase()} · ${place}`, changed: tidy(changed), analysis: tidy(analysis), links };
}

export function buildEscalationNotification(changes: Change[], testing = false): Notification {
  const sorted = [...changes].sort((a, b) => LEVEL_RANK[b.incident.level] - LEVEL_RANK[a.incident.level] || b.incident.updatedAt.localeCompare(a.incident.updatedAt));
  const count = (k: ChangeKind) => sorted.filter((c) => c.kind === k).length;
  const bits = [count("new") && `${count("new")} new`, count("escalated") && `${count("escalated")} raised to a higher level`, count("updated") && `${count("updated")} with new reporting`].filter(Boolean);
  const top = sorted[0].incident;
  const shown = sorted.slice(0, MAX_SECTIONS);
  const more = sorted.length - shown.length;
  const overview = `Conflict escalation feed: ${bits.join(", ")}.${more > 0 ? ` The ${shown.length} most serious are below; ${more} more are on the map.` : ""}`;
  return {
    subject: `${testing ? "[Test] " : ""}[${top.level.toUpperCase()}] Escalation alert: ${top.locationLabel ?? top.countryName}${sorted.length > 1 ? ` and ${sorted.length - 1} more` : ""}`,
    overview,
    sections: shown.map(incidentSection),
    links: [],
    footer: "The Lens · Afrilens Consulting. Manage these alerts in Settings.",
  };
}

async function loadSeen(env: Env, subId: string): Promise<Map<string, { level: string; report_count: number }>> {
  const rows = await all<{ incident_id: string; level: string; report_count: number }>(env.DB, "SELECT incident_id, level, report_count FROM alert_subscription_seen WHERE subscription_id = ?", [subId]);
  return new Map(rows.map((r) => [r.incident_id, { level: r.level, report_count: r.report_count }]));
}

async function markSeen(env: Env, subId: string, incidents: IncidentView[]): Promise<void> {
  for (const i of incidents) {
    await run(
      env.DB,
      `INSERT INTO alert_subscription_seen (subscription_id, incident_id, level, report_count) VALUES (?,?,?,?)
       ON CONFLICT(subscription_id, incident_id) DO UPDATE SET level = excluded.level, report_count = excluded.report_count`,
      [subId, i.id, i.level, i.reportCount]
    );
  }
}

/** Marks everything flagged right now as already known, so a new subscription
 *  announces what happens next rather than replaying the current picture. */
export async function baselineEscalationSubscription(env: Env, subId: string, flagged?: IncidentView[]): Promise<void> {
  await markSeen(env, subId, flagged ?? (await getFlaggedIncidents(env)));
  await run(env.DB, "UPDATE alert_subscriptions SET cursor_at = ? WHERE id = ?", [nowIso(), subId]);
}

export function detectChanges(flagged: IncidentView[], seen: Map<string, { level: string; report_count: number }>, minLevel: MinLevel): Change[] {
  const min = LEVEL_RANK[minLevel];
  const out: Change[] = [];
  for (const incident of flagged) {
    if (LEVEL_RANK[incident.level] < min) continue;
    const prev = seen.get(incident.id);
    if (!prev) out.push({ incident, kind: "new" });
    else if (LEVEL_RANK[incident.level] > LEVEL_RANK[prev.level]) out.push({ incident, kind: "escalated", prevLevel: prev.level });
    else if (incident.reportCount >= prev.report_count + UPDATE_REPORT_STEP) out.push({ incident, kind: "updated", newReports: incident.reportCount - prev.report_count });
  }
  return out;
}

async function runEscalationSub(env: Env, sub: Subscription, flagged: IncidentView[], now: number): Promise<void> {
  if (!sub.cursor_at) {
    await baselineEscalationSubscription(env, sub.id, flagged);
    return;
  }
  const seen = await loadSeen(env, sub.id);
  // An incident that has cleared is forgotten, so it is announced afresh if it returns.
  const live = new Set(flagged.map((i) => i.id));
  for (const id of seen.keys()) if (!live.has(id)) await run(env.DB, "DELETE FROM alert_subscription_seen WHERE subscription_id = ? AND incident_id = ?", [sub.id, id]);

  const changes = detectChanges(flagged, seen, sub.min_level);
  if (changes.length === 0) return;
  const urgent = changes.some((c) => c.kind !== "updated" && c.incident.level === "critical");
  if (!urgent && sub.last_sent_at && now - Date.parse(sub.last_sent_at) < sub.frequency_minutes * 60_000) return;

  const result = await sendNotification(env, sub.channel, sub.destination, buildEscalationNotification(changes));
  await recordSend(env, sub, result);
  if (result.ok) await markSeen(env, sub.id, changes.map((c) => c.incident));
}

// ── Monitoring queries ───────────────────────────────────────────────────

interface MatchRow {
  id: string;
  title: string | null;
  content: string;
  url: string | null;
  sentiment: number | null;
  geo_label: string | null;
  source_type: string;
  matched_at: string;
}

interface Item {
  title: string;
  snippet: string;
  url: string | null;
  source: string;
  place: string | null;
  sentiment: number | null;
}

function toItems(rows: MatchRow[]): Item[] {
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const r of rows) {
    const title = tidy(r.title || r.content).slice(0, 200);
    const key = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const snippet = tidy(r.content);
    items.push({ title, snippet: snippet.toLowerCase() === title.toLowerCase() ? "" : snippet.slice(0, 160), url: r.url, source: domainOf(r.url) ?? r.source_type, place: r.geo_label, sentiment: r.sentiment });
  }
  return items;
}

const QUERY_SYSTEM = `You are an analyst at a conflict-monitoring consultancy writing a short alert for a client who follows one topic. You are given the topic's monitoring query and the headlines/snippets collected since the client's last alert.

Write two things, in plain text:
- "changed": two or three sentences saying concretely what is new: who did what, where. Use only what the items say; name places and actors as they do. If the items repeat one story, say so rather than listing it twice.
- "analysis": two to four sentences of interpretation: what the developments suggest, whether they point one way or conflict, what to watch next, and how firm the evidence is (headlines and snippets only, a single outlet, unconfirmed claims).

Rules: add no facts that are not in the items; no preamble, no bullet points, no item numbers in the text; put the numbers of the items you relied on in "cited".`;

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    changed: { type: "string" },
    analysis: { type: "string" },
    cited: { type: "array", items: { type: "integer" } },
  },
  required: ["changed", "analysis", "cited"],
};

function plainDigest(name: string, total: number, items: Item[]): { changed: string; analysis: string; cited: number[] } {
  const places = countTop(items.map((i) => i.place), 3).map((p) => `${p.label} (${p.count})`);
  const scored = items.filter((i) => i.sentiment !== null);
  const negative = scored.length ? Math.round((100 * scored.filter((i) => (i.sentiment ?? 0) < -0.2).length) / scored.length) : null;
  return {
    changed: `${total} new item${total === 1 ? "" : "s"} matched "${name}".${places.length ? ` Most mentioned places: ${places.join(", ")}.` : ""}${negative !== null ? ` ${negative}% of the coverage reads as negative in tone.` : ""}`,
    analysis: "This is an automatic digest: the AI reading was not available for this update, so the headlines below are listed without interpretation.",
    cited: items.slice(0, 5).map((_, k) => k + 1),
  };
}

interface QueryDigest {
  notification: Notification;
  total: number;
  lastMatchAt: string;
  ai: boolean;
}

export async function buildQueryNotification(env: Env, query: { id: string; name: string; boolean_query: string }, since: string, useAi: boolean, testing = false): Promise<QueryDigest | null> {
  const count = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM query_matches WHERE query_id = ? AND matched_at > ?", [query.id, since]);
  const total = Number(count?.n ?? 0);
  if (total === 0) return null;
  const rows = await all<MatchRow>(
    env.DB,
    `SELECT e.id, e.title, e.content, e.url, e.sentiment, e.geo_label, e.source_type, qm.matched_at
     FROM query_matches qm JOIN events e ON e.id = qm.event_id
     WHERE qm.query_id = ? AND qm.matched_at > ? ORDER BY qm.matched_at DESC LIMIT 200`,
    [query.id, since]
  );
  const items = toItems(rows);
  const shown = items.slice(0, MODEL_ITEMS);
  const alert = await first<{ level: string; title: string; description: string; geo_label: string | null }>(
    env.DB,
    `SELECT level, title, description, geo_label FROM alerts WHERE query_id = ? AND created_at > ?
     ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'elevated' THEN 1 ELSE 2 END, created_at DESC LIMIT 1`,
    [query.id, since]
  );

  let body = plainDigest(query.name, total, shown);
  let ai = false;
  if (useAi && shown.length >= 2) {
    const lines = shown.map((i, k) => `[${k + 1}] ${i.source}${i.place ? ` · ${i.place}` : ""}: ${i.title}${i.snippet ? ` — ${i.snippet}` : ""}`);
    const user = `MONITORING QUERY: ${query.name}\nQUERY SYNTAX: ${clip(query.boolean_query, 300)}\nNEW ITEMS SINCE LAST ALERT: ${total} (${shown.length} distinct headlines shown)${alert ? `\nPLATFORM SIGNAL: ${alert.title}. ${alert.description}` : ""}\n\nITEMS\n${lines.join("\n")}`;
    const result = await callStructured<{ changed?: string; analysis?: string; cited?: unknown[] }>(env, {
      role: "analyst",
      system: QUERY_SYSTEM,
      user,
      schema: QUERY_SCHEMA as unknown as Record<string, unknown>,
      toolName: "record_alert",
      toolDescription: "Record the alert text for the client.",
      maxTokens: 500,
    }).catch(() => null);
    const changed = tidy(result?.data.changed ?? "");
    const analysis = tidy(result?.data.analysis ?? "");
    if (result && changed.length >= 30 && analysis.length >= 30) {
      const cited = [...new Set((result.data.cited ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= shown.length))];
      body = { changed, analysis, cited: cited.length ? cited : shown.slice(0, 5).map((_, k) => k + 1) };
      ai = true;
    }
  }
  const links: NotificationLink[] = body.cited.slice(0, 8).filter((n) => shown[n - 1]?.url).map((n) => ({ title: shown[n - 1].title, url: shown[n - 1].url as string, source: shown[n - 1].source }));
  const tag = alert ? "[ALERT] " : "";
  return {
    total,
    lastMatchAt: rows[0]?.matched_at ?? nowIso(),
    ai,
    notification: {
      subject: `${testing ? "[Test] " : ""}${tag}${query.name}: ${total} new development${total === 1 ? "" : "s"}`,
      overview: `${cap(body.changed)}${alert ? ` The platform has also raised an alert for this query: ${alert.title}.${alert.geo_label ? ` Concentrated near ${alert.geo_label}.` : ""}` : ""}`,
      analysis: body.analysis,
      sections: [],
      links,
      footer: "The Lens · Afrilens Consulting. Manage these alerts on this query's page under Live OSINT.",
    },
  };
}

async function runQuerySub(env: Env, sub: Subscription, now: number, ai: { left: number }): Promise<void> {
  if (!sub.query_id) return;
  const query = await first<{ id: string; name: string; boolean_query: string; is_active: number }>(env.DB, "SELECT id, name, boolean_query, is_active FROM monitoring_queries WHERE id = ?", [sub.query_id]);
  if (!query || !query.is_active) return;
  if (sub.last_sent_at && now - Date.parse(sub.last_sent_at) < sub.frequency_minutes * 60_000) return;

  const floor = new Date(now - QUERY_LOOKBACK_HOURS * 3600_000).toISOString();
  const since = sub.cursor_at && sub.cursor_at > floor ? sub.cursor_at : sub.cursor_at ? floor : sub.created_at;

  if (sub.min_level === "alert") {
    const hit = await first<{ id: string }>(env.DB, "SELECT id FROM alerts WHERE query_id = ? AND created_at > ? LIMIT 1", [query.id, since]);
    if (!hit) return;
  }
  const digest = await buildQueryNotification(env, query, since, ai.left > 0);
  if (!digest) return;
  if (digest.ai) ai.left -= 1;
  const result = await sendNotification(env, sub.channel, sub.destination, digest.notification);
  await recordSend(env, sub, result);
  if (result.ok) await run(env.DB, "UPDATE alert_subscriptions SET cursor_at = ? WHERE id = ?", [nowIso(), sub.id]);
}

// ── Dispatcher ───────────────────────────────────────────────────────────

async function recordSend(env: Env, sub: Subscription, result: { ok: boolean; error?: string }): Promise<void> {
  if (result.ok) await run(env.DB, "UPDATE alert_subscriptions SET last_sent_at = ?, last_status = 'ok', last_error = NULL WHERE id = ?", [nowIso(), sub.id]);
  else {
    console.error(`[alerts] ${sub.channel} send failed for subscription ${sub.id}: ${result.error}`);
    await run(env.DB, "UPDATE alert_subscriptions SET last_status = 'error', last_error = ? WHERE id = ?", [result.error ?? "send failed", sub.id]);
  }
}

export async function dispatchAlertSubscriptions(env: Env): Promise<void> {
  await ensureAlertTables(env);
  const subs = await all<Subscription>(env.DB, "SELECT * FROM alert_subscriptions WHERE enabled = 1");
  if (subs.length === 0) return;

  const available = channelsAvailable(env);
  const now = Date.now();
  const ai = { left: MAX_AI_PER_RUN };
  let flagged: IncidentView[] | null = null;

  for (const sub of subs) {
    try {
      if (!available[sub.channel]) {
        const msg = `${sub.channel === "email" ? "Email" : "Signal"} delivery is not set up on this platform yet, so nothing can be sent.`;
        if (sub.last_error !== msg) await run(env.DB, "UPDATE alert_subscriptions SET last_status = 'error', last_error = ? WHERE id = ?", [msg, sub.id]);
        continue;
      }
      if (sub.scope === "escalations") {
        flagged ??= await getFlaggedIncidents(env);
        await runEscalationSub(env, sub, flagged, now);
      } else {
        await runQuerySub(env, sub, now, ai);
      }
    } catch (err) {
      console.error(`[alerts] subscription ${sub.id} failed`, err);
    }
  }
}

// ── Test message ─────────────────────────────────────────────────────────

/** A real message in the real format, sent on request, so the person can see
 *  what they will get. Does not move the subscription's position. */
export async function sendTestMessage(env: Env, sub: Subscription): Promise<{ ok: boolean; error?: string; note?: string }> {
  if (sub.scope === "escalations") {
    const flagged = (await getFlaggedIncidents(env)).filter((i) => LEVEL_RANK[i.level] >= LEVEL_RANK[sub.min_level]);
    if (flagged.length === 0) {
      const sample: Notification = {
        subject: "[Test] Escalation alert",
        overview: "This is a test of your escalation alerts. No incident is flagged at your chosen level right now, so there is nothing to show; real alerts will look like this, with what changed, an analysis, and links to the reports.",
        sections: [],
        links: [],
        footer: "The Lens · Afrilens Consulting.",
      };
      const r = await sendNotification(env, sub.channel, sub.destination, sample);
      return { ...r, note: "No incident is flagged right now, so a plain test message was sent." };
    }
    return sendNotification(env, sub.channel, sub.destination, buildEscalationNotification(flagged.slice(0, 3).map((incident) => ({ incident, kind: "new" as const })), true));
  }
  const query = sub.query_id ? await first<{ id: string; name: string; boolean_query: string }>(env.DB, "SELECT id, name, boolean_query FROM monitoring_queries WHERE id = ?", [sub.query_id]) : null;
  if (!query) return { ok: false, error: "This query no longer exists." };
  const digest = await buildQueryNotification(env, query, new Date(Date.now() - QUERY_LOOKBACK_HOURS * 3600_000).toISOString(), true, true);
  if (!digest) {
    const r = await sendNotification(env, sub.channel, sub.destination, {
      subject: `[Test] ${query.name}`,
      overview: `This is a test of your alerts for "${query.name}". Nothing new matched in the last ${QUERY_LOOKBACK_HOURS} hours, so there is nothing to summarise; real alerts will give what changed, an analysis, and links.`,
      sections: [],
      links: [],
      footer: "The Lens · Afrilens Consulting.",
    });
    return { ...r, note: "Nothing matched in the last 24 hours, so a plain test message was sent." };
  }
  return sendNotification(env, sub.channel, sub.destination, digest.notification);
}

export const newSubscriptionId = newId;
