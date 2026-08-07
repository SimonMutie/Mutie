import type { Env } from "../bindings";

/**
 * Single global Durable Object instance (addressed via idFromName("global"))
 * that holds every connected dashboard's WebSocket and fans out broadcasts.
 * Replaces the old Node `ws` WebSocketServer — same wire protocol
 * (`{ type, payload }` JSON frames), just hosted as a DO using the
 * hibernatable WebSocket API so idle connections don't keep the DO billed as
 * active.
 */
export class LiveFeedHub implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const { type, payload } = await request.json<{ type: string; payload: unknown }>();
      const message = JSON.stringify({ type, payload });
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(message);
        } catch {
          // client already gone; hibernation API reaps dead sockets on its own
        }
      }
      return new Response("ok");
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "hello", payload: { message: "connected to Sentinel live feed" } }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  // Dashboard clients are receive-only; nothing to act on inbound.
  async webSocketMessage() {}

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // already closing
    }
  }
}
