import type { Env } from "../bindings";
import { tickMockIngestion } from "../ingest";

const TICK_MS = 1200;

/**
 * Single global Durable Object that replaces the old `setInterval(..., 1200)`
 * mock-ingestion loop. A DO alarm has no minimum interval (unlike Cron
 * Triggers, which floor at 1 minute), so it self-reschedules every tick to
 * approximate the original near-real-time cadence indefinitely.
 */
export class IngestionActor implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/start") {
      const existing = await this.state.storage.getAlarm();
      if (existing === null) {
        await this.state.storage.setAlarm(Date.now() + TICK_MS);
      }
      return new Response("started");
    }
    return new Response("ok");
  }

  async alarm() {
    if ((this.env.MOCK_MODE ?? "true") === "true") {
      try {
        await tickMockIngestion(this.env);
      } catch (err) {
        console.error("[ingest] tick failed:", err);
      }
    }
    await this.state.storage.setAlarm(Date.now() + TICK_MS);
  }
}
