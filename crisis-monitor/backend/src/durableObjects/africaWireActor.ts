import type { Env } from "../bindings";
import { AFRICA_SOURCES, PAN_AFRICAN, INSTITUTION } from "../data/africaSources";
import { AFRICA_CENTROIDS } from "../countryEscalation";
import { discoverFeed } from "../lib/feedDiscovery";
import { parseRSSItems, hashId, scoreRisk } from "../lib/osintFeed";
import { detectNonEnglish, translateToEnglish } from "../lib/translate";

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
 * load. Instead this processes a small batch (BATCH_SIZE) each time its
 * /tick endpoint is called — driven by the existing 5-minute cron in
 * index.ts, the same one that already re-kicks the other actors' alarms —
 * cycling through the whole list via a persisted cursor, and remembers
 * each source's discovered feed URL (or that it has none) in Durable
 * Object storage so a full recrawl doesn't repeat that lookup every time.
 * /snapshot then just reads back whatever's accumulated, instantly.
 *
 * A source that has no discoverable feed is recorded as "no_feed" and
 * contributes nothing — never a guessed or fabricated feed URL.
 */

const BATCH_SIZE = 60;
// Raised from 15 — the 15-per-tick figure was never calibrated against a
// real ceiling, just a conservative starting guess from when this crawler
// was first built. Sources within a batch already run in parallel
// (Promise.all below), so batch size was never bottlenecked by sequential
// fetch time, only by how many outbound requests one Durable Object
// invocation issues at once — and Cloudflare's own subrequest cap has
// since been raised from 1,000 to 10,000+ per invocation on paid plans
// (developers.cloudflare.com/changelog, Feb 2026), so 15 was leaving most
// of that headroom unused. 60 means a full cycle through all ~260 sources
// takes roughly 20-25 minutes instead of 85-90, without adding any new
// infrastructure (Cloudflare Queues would fan this out further still, but
// that needs a Queue resource provisioned first — see the OSINT
// collection-scaling research report for that as a follow-up). 60 stays
// comfortably under the ~1,000 req/s a single Durable Object can sustain,
// and each source's own fetch still has its own 8s timeout below, so a
// handful of slow/dead sites in a batch can't stall the rest of it.
// Raised from 5 to 15 at Simon's original request for deeper coverage —
// most of these sites' RSS feeds carry 15-20+ items per fetch already, so
// a small batch was throwing most of each cycle's haul away for no reason.
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

    if (url.pathname === "/tick") {
      const result = await this.runBatch();
      return Response.json(result);
    }

    if (url.pathname === "/snapshot") {
      return Response.json(await this.buildSnapshot());
    }

    return new Response("not found", { status: 404 });
  }

  private async runBatch(): Promise<{ processed: number; cursor: number }> {
    const cursor = (await this.state.storage.get<number>("cursor")) ?? 0;
    const total = AFRICA_SOURCES.length;
    const indices: number[] = [];
    for (let i = 0; i < BATCH_SIZE && i < total; i++) indices.push((cursor + i) % total);

    await Promise.all(indices.map((i) => this.processSource(i)));

    await this.state.storage.put("cursor", (cursor + BATCH_SIZE) % total);
    return { processed: indices.length, cursor: (cursor + BATCH_SIZE) % total };
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
