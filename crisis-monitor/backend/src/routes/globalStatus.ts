import { Hono } from "hono";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

/**
 * Real-data HUD status feeds — not map layers, but the same status-ticker
 * concept OSIRIS's own GlobalStatusBar + MarketsPanel + space-weather HUD
 * readout show (exchange open/closed dots, a CVE count, Kp index, a handful
 * of commodity/crypto quotes). Split out of liveLayers.ts because the
 * response shapes here aren't GeoJSON FeatureCollections.
 *
 * Two things OSIRIS's own source has routes for were deliberately left out
 * after checking its actual frontend (not just its API folder):
 *  - /api/air-quality and /api/frontlines exist as backend routes in
 *    OSIRIS's repo but nothing in its own UI ever fetches either one
 *    (confirmed via a full grep of its page/components) — they're dead
 *    routes, not a real shipped feature, so there's nothing to "match"
 *    here by building them.
 *  - Even if Frontlines were wired up, DeepState Map's own license
 *    requires prior approval for any commercial use of its API — the same
 *    kind of blocker ACLED was earlier this session.
 *  - OSIRIS's Markets panel scrapes Yahoo Finance's undocumented endpoints,
 *    which violates Yahoo's ToS for a commercial product, and OSIRIS's
 *    Country Risk numbers are a hardcoded editorial table, not live data.
 *    Both are rebuilt below from sources actually licensed for this: WTI
 *    crude oil and Henry Hub natural gas are U.S. government (EIA) series
 *    via FRED (public domain, commercial use permitted with attribution —
 *    verified directly against FRED's own Terms of Use); BTC/ETH via
 *    CoinGecko (its API Terms permit charging for products that
 *    incorporate the API); the exchange calendar is computed locally, not
 *    fetched. Gold/silver/wheat and individual equities were dropped
 *    rather than faked — FRED's precious-metal series are owned by ICE
 *    Benchmark Administration/LBMA and require separate permission beyond
 *    personal use, and no free stock-quote API with a verified
 *    commercial-safe free tier (Alpha Vantage, Twelve Data both
 *    explicitly restrict their free tier to personal/internal use) was
 *    found. The "risk" ticker below is a real computed index (live GDELT
 *    incident counts + live USGS earthquake activity per country, both
 *    already-built Lens feeds), not a re-hosting of OSIRIS's invented
 *    numbers.
 */
export const globalStatusRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

globalStatusRouter.use("*", requireAuth);

const CACHE_TTL_SECONDS = 300;

async function cachedJson<T>(request: Request, build: () => Promise<T>, ttlSeconds = CACHE_TTL_SECONDS): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body: T;
  try {
    body = await build();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Upstream feed unavailable", detail: message }, { status: 502 });
  }

  const response = Response.json(body, { headers: { "Cache-Control": `public, max-age=${ttlSeconds}` } });
  await cache.put(cacheKey, response.clone());
  return response;
}

/** NOAA SWPC — fully public U.S. government space-weather data, no key. */
globalStatusRouter.get("/space-weather", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const [kpRes, alertsRes] = await Promise.allSettled([
        fetch("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json", { signal: AbortSignal.timeout(8000) }),
        fetch("https://services.swpc.noaa.gov/json/alerts.json", { signal: AbortSignal.timeout(8000) }),
      ]);

      let kpIndex = 0;
      let kpTimestamp: string | null = null;
      if (kpRes.status === "fulfilled" && kpRes.value.ok) {
        const data = (await kpRes.value.json()) as Array<{ kp_index?: string; Kp?: string; time_tag?: string }>;
        const latest = data[data.length - 1];
        if (latest) {
          kpIndex = Number.parseFloat(latest.kp_index ?? latest.Kp ?? "0") || 0;
          kpTimestamp = latest.time_tag ?? null;
        }
      }

      let stormLevel = "Quiet";
      let stormColor = "#00E676";
      if (kpIndex >= 8) { stormLevel = "Extreme (G5)"; stormColor = "#FF1744"; }
      else if (kpIndex >= 7) { stormLevel = "Severe (G4)"; stormColor = "#FF3D3D"; }
      else if (kpIndex >= 6) { stormLevel = "Strong (G3)"; stormColor = "#FF9500"; }
      else if (kpIndex >= 5) { stormLevel = "Moderate (G2)"; stormColor = "#FFD700"; }
      else if (kpIndex >= 4) { stormLevel = "Minor (G1)"; stormColor = "#FFD700"; }
      else if (kpIndex >= 3) { stormLevel = "Unsettled"; stormColor = "#D4AF37"; }

      const alerts: Array<{ id: string; issuedAt: string | null; message: string }> = [];
      if (alertsRes.status === "fulfilled" && alertsRes.value.ok) {
        const data = (await alertsRes.value.json()) as Array<{ product_id?: string; issue_datetime?: string; message?: string }>;
        for (const a of data.slice(0, 10)) {
          alerts.push({ id: a.product_id ?? `alert-${Date.now()}`, issuedAt: a.issue_datetime ?? null, message: (a.message ?? "").slice(0, 200) });
        }
      }

      return { kpIndex, stormLevel, stormColor, kpTimestamp, alerts, fetchedAt: new Date().toISOString() };
    },
    600
  );
});

/** CISA's Known Exploited Vulnerabilities catalog — authoritative US
 *  government source, public domain, no key, updated as CISA adds entries. */
globalStatusRouter.get("/cyber-threats", async (c) => {
  return cachedJson(c.req.raw, async () => {
    const res = await fetch("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`CISA KEV feed returned ${res.status}`);
    const data = (await res.json()) as {
      vulnerabilities?: Array<{ cveID: string; vulnerabilityName: string; vendorProject: string; product: string; dateAdded: string; dueDate: string }>;
    };
    const all = data.vulnerabilities ?? [];
    const recent = all
      .filter((v) => (Date.now() - new Date(v.dateAdded).getTime()) / 86_400_000 <= 30)
      .slice(0, 15)
      .map((v) => ({
        id: v.cveID,
        name: v.vulnerabilityName,
        vendor: v.vendorProject,
        product: v.product,
        dateAdded: v.dateAdded,
        dueDate: v.dueDate,
        source: "CISA KEV",
      }));
    return { recentCount: recent.length, catalogTotal: all.length, vulnerabilities: recent, fetchedAt: new Date().toISOString() };
  });
});

const EXCHANGES = [
  { name: "NYSE", tz: "America/New_York", open: 9.5, close: 16, country: "US" },
  { name: "NASDAQ", tz: "America/New_York", open: 9.5, close: 16, country: "US" },
  { name: "LSE", tz: "Europe/London", open: 8, close: 16.5, country: "GB" },
  { name: "TSE", tz: "Asia/Tokyo", open: 9, close: 15, country: "JP" },
  { name: "SSE", tz: "Asia/Shanghai", open: 9.5, close: 15, country: "CN" },
  { name: "HKEX", tz: "Asia/Hong_Kong", open: 9.5, close: 16, country: "HK" },
  { name: "FRA", tz: "Europe/Berlin", open: 8, close: 20, country: "DE" },
  { name: "ASX", tz: "Australia/Sydney", open: 10, close: 16, country: "AU" },
];

function isExchangeOpen(ex: (typeof EXCHANGES)[number]): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: ex.tz, hour: "numeric", minute: "numeric", hour12: false, weekday: "short" });
    const parts = formatter.formatToParts(new Date());
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    if (["Sat", "Sun"].includes(weekday)) return false;
    const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const decimal = hour + minute / 60;
    return decimal >= ex.open && decimal < ex.close;
  } catch {
    return false;
  }
}

/** FRED series IDs used below are U.S. government (EIA) data, verified
 *  directly against FRED's Terms of Use as not requiring third-party
 *  permission — unlike FRED's precious-metal series, which are
 *  ICE Benchmark Administration/LBMA owned. */
const FRED_SERIES: { id: string; label: string; unit: string }[] = [
  { id: "DCOILWTICO", label: "WTI Crude Oil", unit: "$/bbl" },
  { id: "DHHNGSP", label: "Henry Hub Natural Gas", unit: "$/MMBtu" },
];

async function fetchFredSeries(seriesId: string, apiKey: string): Promise<{ value: number; date: string; changePercent: number | null } | null> {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=2`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { observations?: Array<{ date: string; value: string }> };
  const obs = (data.observations ?? []).filter((o) => o.value !== ".");
  if (obs.length === 0) return null;
  const latest = Number.parseFloat(obs[0].value);
  const prev = obs[1] ? Number.parseFloat(obs[1].value) : null;
  const changePercent = prev ? ((latest - prev) / prev) * 100 : null;
  return { value: latest, date: obs[0].date, changePercent };
}

async function fetchCoinGeckoCrypto(): Promise<Record<string, { price: number; changePercent: number }>> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true", {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return {};
  const data = (await res.json()) as Record<string, { usd: number; usd_24h_change: number }>;
  const out: Record<string, { price: number; changePercent: number }> = {};
  if (data.bitcoin) out.Bitcoin = { price: data.bitcoin.usd, changePercent: data.bitcoin.usd_24h_change ?? 0 };
  if (data.ethereum) out.Ethereum = { price: data.ethereum.usd, changePercent: data.ethereum.usd_24h_change ?? 0 };
  return out;
}

/** Exchange calendar (computed, no licensing concern) + WTI/Henry Hub via
 *  FRED (EIA-sourced, commercial-safe) + BTC/ETH via CoinGecko. No
 *  individual equities or precious metals — see the file-level comment for
 *  why those were dropped rather than faked. Requires FRED_API_KEY (free,
 *  register at fred.stlouisfed.org/docs/api/api_key.html); returns the
 *  exchange/crypto data with commodities omitted if unset. */
globalStatusRouter.get("/markets", async (c) => {
  return cachedJson(c.req.raw, async () => {
    const exchanges = EXCHANGES.map((ex) => ({ name: ex.name, country: ex.country, open: isExchangeOpen(ex) }));
    const openCount = exchanges.filter((e) => e.open).length;

    const fredKey = c.env.FRED_API_KEY;
    const commodities: Record<string, { value: number; unit: string; date: string; changePercent: number | null }> = {};
    if (fredKey) {
      const results = await Promise.allSettled(FRED_SERIES.map((s) => fetchFredSeries(s.id, fredKey)));
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value) {
          commodities[FRED_SERIES[i].label] = { ...r.value, unit: FRED_SERIES[i].unit };
        }
      });
    }

    let crypto: Record<string, { price: number; changePercent: number }> = {};
    try {
      crypto = await fetchCoinGeckoCrypto();
    } catch {
      crypto = {};
    }

    return {
      exchanges,
      openCount,
      commodities,
      commoditiesAvailable: Boolean(fredKey),
      crypto,
      fetchedAt: new Date().toISOString(),
    };
  });
});

const RISK_COUNTRY_HINTS: Record<string, string> = {
  UA: "Ukraine", RU: "Russia", IL: "Israel", PS: "Palestine", SY: "Syria", YE: "Yemen", MM: "Myanmar",
  SD: "Sudan", AF: "Afghanistan", KP: "North Korea", IR: "Iran", TW: "Taiwan", VE: "Venezuela", HT: "Haiti",
  LB: "Lebanon", PK: "Pakistan", SO: "Somalia", LY: "Libya", ET: "Ethiopia",
};

/** A real composite, computed live from two feeds this app already builds
 *  honestly (USGS earthquakes, GDELT global incidents) — not OSIRIS's
 *  hardcoded per-country numbers. This is a coarse text-match against each
 *  event's place/location string, not a geocoded count, so treat it as a
 *  rough activity signal, not a precision index. */
globalStatusRouter.get("/activity-index", async (c) => {
  return cachedJson(c.req.raw, async () => {
    const [quakeRes, gdeltRes] = await Promise.allSettled([
      fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson", {
        signal: AbortSignal.timeout(8000),
      }),
      fetch(
        `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(
          "incident OR explosion OR protest OR unrest OR riot OR crime OR terrorism"
        )}&mode=PointData&format=geojson&timespan=24h`,
        { signal: AbortSignal.timeout(10000) }
      ),
    ]);

    const scores: Record<string, number> = {};
    const bump = (code: string, amount: number) => {
      scores[code] = (scores[code] ?? 0) + amount;
    };

    if (quakeRes.status === "fulfilled" && quakeRes.value.ok) {
      const data = (await quakeRes.value.json()) as { features?: Array<{ properties?: { place?: string; mag?: number } }> };
      for (const f of data.features ?? []) {
        const place = (f.properties?.place ?? "").toLowerCase();
        const mag = f.properties?.mag ?? 0;
        for (const [code, name] of Object.entries(RISK_COUNTRY_HINTS)) {
          if (place.includes(name.toLowerCase())) bump(code, mag);
        }
      }
    }

    if (gdeltRes.status === "fulfilled" && gdeltRes.value.ok) {
      const data = (await gdeltRes.value.json()) as { features?: Array<{ properties?: { name?: string } }> };
      for (const f of data.features ?? []) {
        const name = (f.properties?.name ?? "").toLowerCase();
        for (const [code, countryName] of Object.entries(RISK_COUNTRY_HINTS)) {
          if (name.includes(countryName.toLowerCase())) bump(code, 1);
        }
      }
    }

    const countries = Object.entries(scores)
      .map(([code, score]) => ({ code, name: RISK_COUNTRY_HINTS[code], activityScore: Number(score.toFixed(1)) }))
      .sort((a, b) => b.activityScore - a.activityScore)
      .slice(0, 10);

    return { countries, fetchedAt: new Date().toISOString() };
  });
});

/** ISO-3166-1 alpha-2 codes for Afrilens's core coverage area — every
 *  UN-recognized African state, matching this app's actual focus (African
 *  security monitoring) rather than the whole world. */
const AFRICA_COUNTRIES: Record<string, string> = {
  DZ: "Algeria", AO: "Angola", BJ: "Benin", BW: "Botswana", BF: "Burkina Faso", BI: "Burundi",
  CM: "Cameroon", CV: "Cabo Verde", CF: "Central African Republic", TD: "Chad", KM: "Comoros",
  CG: "Congo (Rep.)", CD: "Congo (DRC)", CI: "Côte d'Ivoire", DJ: "Djibouti", EG: "Egypt",
  GQ: "Equatorial Guinea", ER: "Eritrea", SZ: "Eswatini", ET: "Ethiopia", GA: "Gabon", GM: "Gambia",
  GH: "Ghana", GN: "Guinea", GW: "Guinea-Bissau", KE: "Kenya", LS: "Lesotho", LR: "Liberia",
  LY: "Libya", MG: "Madagascar", MW: "Malawi", ML: "Mali", MR: "Mauritania", MU: "Mauritius",
  MA: "Morocco", MZ: "Mozambique", NA: "Namibia", NE: "Niger", NG: "Nigeria", RW: "Rwanda",
  ST: "São Tomé and Príncipe", SN: "Senegal", SC: "Seychelles", SL: "Sierra Leone", SO: "Somalia",
  ZA: "South Africa", SS: "South Sudan", SD: "Sudan", TZ: "Tanzania", TG: "Togo", TN: "Tunisia",
  UG: "Uganda", ZM: "Zambia", ZW: "Zimbabwe",
};

/** World Bank Indicators API v2 (CC-BY 4.0, no key, commercial use
 *  explicitly permitted — verified directly against
 *  datacatalog.worldbank.org/public-licenses). One indicator per call is
 *  the API's own constraint, not a choice made here — it doesn't support
 *  combining several indicators in a single request. `mrnev=1` asks for
 *  each country's Most Recent Non-Empty Value, since indicators update on
 *  different real-world schedules (quarterly, annually) and a fixed year
 *  would leave gaps. NE.TRD.GNFS.ZS (trade as % of GDP) stands in for
 *  bilateral trade-flow detail (UN Comtrade) — Comtrade's own policy
 *  requires a paid license for any for-profit application, so it isn't
 *  built here; this is the closest real, free substitute. */
const WB_INDICATORS: { id: string; key: string; label: string; unit: string }[] = [
  { id: "NY.GDP.MKTP.CD", key: "gdpUsd", label: "GDP", unit: "US$" },
  { id: "NY.GDP.MKTP.KD.ZG", key: "gdpGrowthPct", label: "GDP growth", unit: "%/yr" },
  { id: "FP.CPI.TOTL.ZG", key: "inflationPct", label: "Inflation (CPI)", unit: "%/yr" },
  { id: "NE.TRD.GNFS.ZS", key: "tradePctGdp", label: "Trade", unit: "% of GDP" },
];

async function fetchWorldBankIndicator(indicatorId: string, countryCodes: string[]): Promise<Map<string, { value: number; date: string }>> {
  const url = `https://api.worldbank.org/v2/country/${countryCodes.join(";")}/indicator/${indicatorId}?format=json&mrnev=1&per_page=20000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`World Bank API returned ${res.status} for ${indicatorId}`);
  const data = (await res.json()) as [unknown, Array<{ country: { id: string; value: string }; value: number | null; date: string }> | null];
  const rows = data[1] ?? [];
  const out = new Map<string, { value: number; date: string }>();
  for (const row of rows) {
    if (row.value === null) continue;
    out.set(row.country.id, { value: row.value, date: row.date });
  }
  return out;
}

/** No key, no rate limit posted, CC-BY 4.0 — see the comments above. Cached
 *  6h: these indicators genuinely only update quarterly/annually upstream,
 *  so this is about being a considerate API citizen, not freshness. */
globalStatusRouter.get("/economic-indicators", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const codes = Object.keys(AFRICA_COUNTRIES);
      const perIndicator = await Promise.all(WB_INDICATORS.map((ind) => fetchWorldBankIndicator(ind.id, codes)));

      const countries = codes.map((code) => {
        const entry: Record<string, unknown> = { code, name: AFRICA_COUNTRIES[code] };
        WB_INDICATORS.forEach((ind, i) => {
          const hit = perIndicator[i].get(code);
          entry[ind.key] = hit ? hit.value : null;
          entry[`${ind.key}Date`] = hit ? hit.date : null;
        });
        return entry;
      });

      return {
        countries,
        indicators: WB_INDICATORS.map(({ key, label, unit }) => ({ key, label, unit })),
        source: "World Bank Open Data (CC-BY 4.0)",
        fetchedAt: new Date().toISOString(),
      };
    },
    21600
  );
});
