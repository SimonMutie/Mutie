import type { Env } from "../bindings";

/** One vessel's most recent known position, keyed by MMSI in the in-memory
 *  snapshot below. Deliberately not persisted to storage — this is a live
 *  feed, so a dropped connection just means a brief gap until the next
 *  PositionReport for that vessel arrives, rather than something worth
 *  paying storage-write cost for on every message. */
interface VesselPosition {
  mmsi: number;
  name: string | null;
  lat: number;
  lng: number;
  /** Speed over ground, knots. */
  speedKn: number | null;
  /** Course over ground, degrees. */
  courseDeg: number | null;
  lastUpdate: string;
}

/** AISstream.io's own shape for a PositionReport frame — see
 *  aisstream.io/documentation. Only the fields this app uses are typed;
 *  the stream carries other MessageTypes (ShipStaticData, etc.) that this
 *  actor ignores. */
interface AisPositionReportFrame {
  MessageType: "PositionReport" | string;
  MetaData?: { MMSI?: number; ShipName?: string; time_utc?: string };
  Message?: {
    PositionReport?: { UserID?: number; Sog?: number; Cog?: number; Latitude?: number; Longitude?: number; Valid?: boolean };
  };
}

const RECONNECT_CHECK_MS = 60_000;
/** Drop a vessel from the snapshot if nothing's been heard from it in this
 *  long — otherwise a ship that went out of AIS range (or into port with
 *  its transponder off) would sit on the map forever at its last position. */
const STALE_AFTER_MS = 20 * 60_000;

/** Whole-planet bounding box — AISstream.io requires at least one
 *  BoundingBoxes entry even for "no filtering", so this is the documented
 *  way to ask for global coverage rather than a real geographic filter. */
const GLOBAL_BBOX: [[number, number], [number, number]][] = [[[-90, -180], [90, 180]]];

/**
 * Holds the single persistent outbound WebSocket connection to
 * AISstream.io (wss://stream.aisstream.io/v0/stream) and an in-memory
 * snapshot of the most recent position per vessel (by MMSI), which the
 * /api/live-layers/ais-vessels route polls on each request.
 *
 * Real global AIS data — see AISSTREAM_API_KEY's comment in bindings.ts
 * for why this source specifically (and its real caveat: no published
 * terms of service or SLA, accepted as a known trade-off).
 *
 * Cloudflare Workers/Durable Objects don't offer a "connect out and hold
 * a WebSocket forever" primitive with guarantees — the connection can
 * drop (network blip, the DO getting evicted under memory pressure, the
 * remote server bouncing it) with nothing here to notice immediately.
 * The alarm below is the safety net: every RECONNECT_CHECK_MS it checks
 * whether the socket is still OPEN and reconnects if not, so an outage
 * self-heals within at most one check interval rather than needing a
 * manual restart.
 */
export class AisIngestionActor implements DurableObject {
  private ws: WebSocket | null = null;
  private readonly vessels = new Map<number, VesselPosition>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      const existing = await this.state.storage.getAlarm();
      if (existing === null) {
        await this.state.storage.setAlarm(Date.now() + RECONNECT_CHECK_MS);
      }
      this.ensureConnected();
      return new Response("started");
    }

    if (url.pathname === "/snapshot") {
      const now = Date.now();
      const fresh = [...this.vessels.values()].filter((v) => now - Date.parse(v.lastUpdate) < STALE_AFTER_MS);
      return Response.json({
        connected: this.ws?.readyState === WebSocket.READY_STATE_OPEN,
        vessels: fresh,
        fetchedAt: new Date().toISOString(),
      });
    }

    return new Response("not found", { status: 404 });
  }

  async alarm() {
    this.ensureConnected();
    await this.state.storage.setAlarm(Date.now() + RECONNECT_CHECK_MS);
  }

  private ensureConnected() {
    if (this.ws && this.ws.readyState === WebSocket.READY_STATE_OPEN) return;
    if (!this.env.AISSTREAM_API_KEY) return; // nothing to connect with yet — /ais-vessels reports this
    this.connectToAisStream().catch((err) => console.error("[ais] connect failed:", err));
  }

  private async connectToAisStream(): Promise<void> {
    // Outbound WebSocket from a Worker/Durable Object: an Upgrade-header
    // fetch, not `new WebSocket(url)` — Workers don't support constructing
    // a raw outbound WebSocket directly, only accepting the one a fetch
    // upgrade response hands back.
    const resp = await fetch("https://stream.aisstream.io/v0/stream", { headers: { Upgrade: "websocket" } });
    const ws = resp.webSocket;
    if (!ws) throw new Error("aisstream.io did not upgrade the connection to a WebSocket");
    ws.accept();
    this.ws = ws;

    ws.addEventListener("message", (event) => {
      try {
        this.handleFrame(JSON.parse(typeof event.data === "string" ? event.data : "") as AisPositionReportFrame);
      } catch {
        // one malformed frame shouldn't take down the connection
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
    });
    ws.addEventListener("error", () => {
      if (this.ws === ws) this.ws = null;
    });

    // AISstream.io requires the first subscription message within 3
    // seconds of connecting (aisstream.io/documentation) — sent
    // immediately here, well within that window.
    ws.send(
      JSON.stringify({
        APIKey: this.env.AISSTREAM_API_KEY,
        BoundingBoxes: GLOBAL_BBOX,
        FilterMessageTypes: ["PositionReport"],
      })
    );
  }

  private handleFrame(frame: AisPositionReportFrame) {
    if (frame.MessageType !== "PositionReport") return;
    const pr = frame.Message?.PositionReport;
    const mmsi = frame.MetaData?.MMSI ?? pr?.UserID;
    const lat = pr?.Latitude;
    const lng = pr?.Longitude;
    if (!mmsi || lat === undefined || lng === undefined || pr?.Valid === false) return;

    this.vessels.set(mmsi, {
      mmsi,
      name: frame.MetaData?.ShipName?.trim() || null,
      lat,
      lng,
      speedKn: pr?.Sog ?? null,
      courseDeg: pr?.Cog ?? null,
      lastUpdate: frame.MetaData?.time_utc ?? new Date().toISOString(),
    });

    // Cheap bound on memory/response size — global AIS traffic is well
    // over 100k distinct vessels; keep the most recently-updated ones.
    if (this.vessels.size > 20_000) {
      const oldest = [...this.vessels.entries()].sort((a, b) => Date.parse(a[1].lastUpdate) - Date.parse(b[1].lastUpdate))[0];
      if (oldest) this.vessels.delete(oldest[0]);
    }
  }
}
