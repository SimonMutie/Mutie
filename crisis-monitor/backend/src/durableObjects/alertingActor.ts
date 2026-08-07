import type { Env } from "../bindings";
import { scoreEscalations } from "../alerting";

const TICK_MS = 30_000;

/** Single global Durable Object that replaces the old `setInterval(..., 30_000)` escalation-scoring loop. */
export class AlertingActor implements DurableObject {
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
    try {
      await scoreEscalations(this.env);
    } catch (err) {
      console.error("[alerting] scoring failed:", err);
    }
    await this.state.storage.setAlarm(Date.now() + TICK_MS);
  }
}
