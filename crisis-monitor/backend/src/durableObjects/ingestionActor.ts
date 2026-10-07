import type { Env } from "../bindings";
import { tickMockIngestion } from "../ingest";

const TICK_MS = 1200;

/**
 * Single global Durable Object that replaces the old `setInterval(..., 1200)`
 * mock-ingestion loop. A DO alarm has no minimum interval (unlike Cron
 * Triggers, which floor at 1 minute), so it self-reschedules every tick to
 * approximate the original near-real-time cadence.
 *
 * Only while MOCK_MODE is on. With it off (the live site) there is nothing
 * to generate, and an alarm that woke every 1.2 seconds to do nothing was
 * some 72,000 wake-ups and as many stored alarm writes a day against the
 * free allowance. So with MOCK_MODE off no alarm is set, and one left over
 * from before fires once and is not set again.
 */
export class IngestionActor implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/start") {
      if (!this.mockMode()) {
        await this.state.storage.deleteAlarm();
        return new Response("mock mode is off");
      }
      const existing = await this.state.storage.getAlarm();
      if (existing === null) {
        await this.state.storage.setAlarm(Date.now() + TICK_MS);
      }
      return new Response("started");
    }
    return new Response("ok");
  }

  private mockMode(): boolean {
    return (this.env.MOCK_MODE ?? "true") === "true";
  }

  async alarm() {
    if (!this.mockMode()) return; // not rescheduled
    try {
      await tickMockIngestion(this.env);
    } catch (err) {
      console.error("[ingest] tick failed:", err);
    }
    await this.state.storage.setAlarm(Date.now() + TICK_MS);
  }
}
