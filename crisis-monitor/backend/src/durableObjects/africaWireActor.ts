import type { Env } from "../bindings";
import { AFRICA_SOURCES, PAN_AFRICAN, INSTITUTION } from "../data/africaSources";
import { AFRICA_CENTROIDS } from "../countryEscalation";
import { discoverFeed } from "../lib/feedDiscovery";
import { parseRSSItems, hashId, scoreRisk } from "../lib/osintFeed";
import { detectNonEnglish, translateToEnglish } from "../lib/translate";
import { matchEscalationKeywords, isConfirmedEscalationText } from "../lib/escalationKeywords";

/**
 * Crawls the ~260 African country/pan-African/institutional homepages in
 * data/africaSources.ts, discovering each one's RSS feed (see
 * lib/feedDiscovery.ts) and pulling its recent items — Simon's own source
 * list, added for country-by-country African coverage beyond the global
 * Telegram/wire OSINT feed in lib/osintFeed.ts.
 *
 * Why a Durable Object rather than doing this on request: fetching and
 * parsing 260 sites can't happen inside one HTTP request/response cycle
 * without either timing it out or hammering all 260 at once on every page
 * load. Each source is instead processed individually via /process-source,
 * fed by messages on the "africa-wire-crawl" Cloudflare Queue (producer in
 * index.ts's scheduled(), consumer also in index.ts) — the queue is what
 * fans the crawl out across many invocations and paces it (see
 * max_batch_size/max_batch_timeout in wrangler.toml) rather than a single
 * Durable Object invocation looping through a fixed batch. This actor
 * remembers each source's discovered feed URL (or that it has none) in
 * Durable Object storage so a full recrawl doesn't repeat that lookup
 * every time. /snapshot then just reads back whatever's accumulated,
 * instantly.
 *
 * Previously this ran as a self-contained cursor-batched loop (a fixed
 * BATCH_SIZE processed per 5-minute cron tick, cycling through the list
 * via a persisted cursor) entirely inside one DO invocation's Promise.all.
 * Moving the fan-out to a real queue means every source gets a fresh
 * attempt each tick (no more 20-25 minute cursor lag to cycle through all
 * ~260), with the queue's own per-message retry handling a source that
 * fails transiently, instead of that being this actor's job.
 *
 * A source that has no discoverable feed is recorded as "no_feed" and
 * contributes nothing — never a guessed or fabricated feed URL.
 */

const ITEMS_PER_SOURCE = 20;
const MAX_ITEM_AGE_MS = 5 * 24 * 3_600_000; // country papers publish far less often than a wire service
// scoreRisk() (lib/osintFeed.ts) matches English keywords only, so a
// French/Portuguese/Arabic item currently scores near zero regardless of
// actual severity — a real blind spot across the Francophone/Lusophone/
// Arabic-press share of the 260 sources. Translating the top few items per
// source (not all ITEMS_PER_SOURCE) bounds worst-case Workers AI calls to
// BATCH_SIZE * this, keeping one tick's translation cost/latency bounded
// even if every source in a batch turns out to be non-English — a quick,
// representative sample rather than exhaustively translating every item,
// which can be raised later once real Workers AI latency/cost is observed.
const TRANSLATE_TOP_N_PER_SOURCE = 5;
/** Re-run discovery for a source (rather than trusting its last discovered
 *  feedUrl) after this long, in case a site restructures. */
const REDISCOVER_AFTER_MS = 7 * 24 * 3_600_000;

interface SourceState {
  url: string;
  country: string;
  status: "ok" | "no_feed" | "error";
  feedUrl?: string;
  lastCheckedAt: string;
  lastError?: string;
}

interface WireItem {
  id: string;
  index: number;
  country: string;
  domain: string;
  title: string;
  link: string;
  published: string;
  description: string;
  /** Set only when title+description were detected as likely non-English
   *  and successfully translated (see lib/translate.ts) — the combined
   *  English text buildSnapshot() risk-scores against instead of the raw
   *  (untranslated) title+description when present. Original title/
   *  description are kept as-is for display either way. */
  riskTextEn?: string;
}

/** One Africa Wire article that literally matched one or more of Simon's
 *  escalation keywords (see lib/escalationKeywords.ts) — the real,
 *  reachable article link + title this keyword flagged, not a GDELT
 *  structured-event row. Returned grouped by country so
 *  countryEscalation.ts's getAfricaWireEscalationEvidence() can merge these
 *  straight into a country's evidence list alongside its GDELT evidence. */
export interface EscalationArticleMatch {
  id: string;
  title: string;
  link: string;
  published: string;
  domain: string;
  matchedKeywords: string[];
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export class AfricaWireActor implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/process-source") {
      const index = Number(url.searchParams.get("index"));
      if (!Number.isInteger(index) || index < 0 || index >= AFRICA_SOURCES.length) {
        return Response.json({ error: "invalid index" }, { status: 400 });
      }
      await this.processSource(index);
      return Response.json({ processed: index });
    }

    if (url.pathname === "/snapshot") {
      return Response.json(await this.buildSnapshot());
    }

    if (url.pathname === "/keyword-matches") {
      const country = url.searchParams.get("country") ?? undefined;
      return Response.json({ matches: await this.getKeywordMatches(country) });
    }

    return new Response("not found", { status: 404 });
  }

  /** Scans every already-crawled Africa Wire item (across whichever of the
   *  ~260 sources have been processed so far — no re-fetch, this just reads
   *  back DO storage already populated by processSource()) for a literal
   *  match against Simon's escalation keyword list, grouped by country code
   *  — the real-article counterpart to countryEscalation.ts's CAMEO-code-
   *  based GDELT scoring, which has no raw article text to match against.
   *  `countryCode` narrows to one country; omitted, every country with at
   *  least one match is returned. Each country's matches are capped and
   *  newest-first, same shape as the GDELT evidence list this gets merged
   *  with (see countryEscalation.ts's getAfricaWireEscalationEvidence). */
  private async getKeywordMatches(countryCode?: string): Promise<Record<string, EscalationArticleMatch[]>> {
    const MAX_PER_COUNTRY = 30;
    const itemEntries = await this.state.storage.list<WireItem[]>({ prefix: "items:" });
    const byCountry: Record<string, EscalationArticleMatch[]> = {};

    for (const items of itemEntries.values()) {
      for (const it of items) {
        if (countryCode && it.country !== countryCode) continue;
        // riskTextEn (translated) when present — matching the already-
        // translated text catches a non-English source's own report of
        // these terms, same as scoreRisk() does for the general risk score.
        const text = `${it.riskTextEn ?? `${it.title} ${it.description}`}`;
        // isConfirmedEscalationText, not a bare matchEscalationKeywords().length
        // check — a named non-state armed group or an unambiguous action term
        // (drone strike, massacre, car bomb...) confirms alone, but an
        // ambiguous phrase (clash, siege, took control of...) only counts once
        // a real armed actor (named group or named state military) is also
        // present in the same text. This is what keeps this escalation-only
        // evidence route from flagging a story just because it contains a
        // word like "clash" or "siege" used in its ordinary, non-military
        // sense. matchEscalationKeywords is still used for the display labels
        // once confirmed — see lib/escalationKeywords.ts's own doc comment.
        if (!isConfirmedEscalationText(text)) continue;
        const matchedKeywords = matchEscalationKeywords(text);
        const list = byCountry[it.country] ?? (byCountry[it.country] = []);
        list.push({ id: it.id, title: it.title, link: it.link, published: it.published, domain: it.domain, matchedKeywords });
      }
    }

    for (const key of Object.keys(byCountry)) {
      byCountry[key].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
      byCountry[key] = byCountry[key].slice(0, MAX_PER_COUNTRY);
    }
    return byCountry;
  }

  private async processSource(index: number): Promise<void> {
    const source = AFRICA_SOURCES[index];
    if (!source) return;
    const key = `source:${index}`;
    const existing = await this.state.storage.get<SourceState>(key);
    const now = Date.now();
    const needsDiscovery = !existing || existing.status !== "ok" || now - Date.parse(existing.lastCheckedAt) > REDISCOVER_AFTER_MS;

    let feedUrl: string | undefined = existing?.status === "ok" ? existing.feedUrl : undefined;
    let state: SourceState;

    if (needsDiscovery) {
      const discovered = await discoverFeed(source.url);
      if (discovered.status === "ok") {
        feedUrl = discovered.feedUrl;
        state = { url: source.url, country: source.country, status: "ok", feedUrl, lastCheckedAt: new Date(now).toISOString() };
      } else if (discovered.status === "no_feed") {
        state = { url: source.url, country: source.country, status: "no_feed", lastCheckedAt: new Date(now).toISOString() };
      } else {
        state = { url: source.url, country: source.country, status: "error", lastError: discovered.message, lastCheckedAt: new Date(now).toISOString() };
      }
      await this.state.storage.put(key, state);
    } else {
      state = existing!;
    }

    if (state.status !== "ok" || !feedUrl) return;

    try {
      const res = await fetch(feedUrl, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLens/1.0)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseRSSItems(await res.text(), domainOf(source.url)).slice(0, ITEMS_PER_SOURCE);
      const fresh = items.filter((it) => now - Date.parse(it.pubDate) <= MAX_ITEM_AGE_MS);

      let translateBudget = TRANSLATE_TOP_N_PER_SOURCE;
      const wireItems: WireItem[] = await Promise.all(
        fresh.map(async (it) => {
          const combined = `${it.title} ${it.description}`;
          let riskTextEn: string | undefined;
          if (translateBudget > 0 && detectNonEnglish(combined)) {
            translateBudget--;
            const result = await translateToEnglish(this.env, combined);
            if (result.translated) riskTextEn = result.text;
          }
          return {
            id: hashId(`${index}:${it.link || it.title}`),
            index,
            country: source.country,
            domain: domainOf(source.url),
            title: it.title,
            link: it.link,
            published: it.pubDate,
            description: it.description,
            riskTextEn,
          };
        })
      );
      await this.state.storage.put(`items:${index}`, wireItems);
    } catch (err) {
      // A working feed that fails on one particular fetch (transient 5xx,
      // timeout) shouldn't flip the source back to "error" and force a
      // rediscovery next cycle — just leave whatever items it last had.
      await this.state.storage.put(key, { ...state, lastError: err instanceof Error ? err.message : "fetch failed" });
    }
  }

  private async buildSnapshot(): Promise<{
    alerts: (WireItem & { risk_score: number; risk_keywords: string[]; coords: [number, number] | null; coords_default: boolean })[];
    sourceHealth: { total: number; ok: number; no_feed: number; error: number; pending: number };
    fetchedAt: string;
  }> {
    const sourceEntries = await this.state.storage.list<SourceState>({ prefix: "source:" });
    const itemEntries = await this.state.storage.list<WireItem[]>({ prefix: "items:" });

    let ok = 0, noFeed = 0, error = 0;
    for (const s of sourceEntries.values()) {
      if (s.status === "ok") ok++;
      else if (s.status === "no_feed") noFeed++;
      else error++;
    }

    const allItems = [...itemEntries.values()].flat();
    const alerts = allItems.map((it) => {
      const risk = scoreRisk(it.riskTextEn ?? `${it.title} ${it.description}`);
      const centroid = AFRICA_CENTROIDS[it.country];
      return {
        ...it,
        risk_score: risk.score,
        risk_keywords: risk.matched,
        coords: centroid ?? null,
        coords_default: !centroid || it.country === PAN_AFRICAN || it.country === INSTITUTION,
      };
    });
    alerts.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

    return {
      alerts,
      sourceHealth: { total: AFRICA_SOURCES.length, ok, no_feed: noFeed, error, pending: AFRICA_SOURCES.length - sourceEntries.size },
      fetchedAt: new Date().toISOString(),
    };
  }
}
