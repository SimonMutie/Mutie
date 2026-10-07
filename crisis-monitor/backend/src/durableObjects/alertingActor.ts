import type { Env } from "../bindings";

/**
 * Retired. This object used to score every monitoring query every 30
 * seconds from its alarm; that work now runs from the scheduled handler
 * (see queryWatch.ts), far less often and against a daily baseline.
 *
 * The class stays because the Worker's Durable Object bindings and
 * migrations name it. It no longer sets an alarm, and an alarm left over
 * from before fires once, does nothing, and is not set again.
 */
export class AlertingActor implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(_request: Request): Promise<Response> {
    await this.state.storage.deleteAlarm();
    return new Response("retired");
  }

  async alarm() {
    // Intentionally empty: not rescheduled.
  }
}
