import type { Env } from "../bindings";
import type { UserRole } from "../types";
import { verifySessionToken } from "../auth";

interface SocketIdentity {
  userId: string;
  role: UserRole;
}

interface BroadcastRequest {
  type: string;
  payload: unknown;
  /** Which clients' sockets should receive this — admins always receive everything regardless. */
  ownerIds: string[];
}

/**
 * Single global Durable Object instance (addressed via idFromName("global"))
 * that holds every connected dashboard's WebSocket and fans out broadcasts.
 * Each socket is authenticated at connect time (a session token, same as the
 * REST API) and tagged with its owning user/role via the hibernatable
 * WebSocket attachment API, so a client's connection only ever receives
 * events/alerts/escalations for queries *they* own — the isolation is
 * enforced here, not just hidden in the UI.
 */
export class LiveFeedHub implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const { type, payload, ownerIds } = await request.json<BroadcastRequest>();
      const message = JSON.stringify({ type, payload });
      for (const ws of this.state.getWebSockets()) {
        const identity = this.readIdentity(ws);
        if (!identity) continue;
        if (identity.role !== "admin" && !ownerIds.includes(identity.userId)) continue;
        try {
          ws.send(message);
        } catch {
          // client already gone; hibernation API reaps dead sockets on its own
        }
      }
      return new Response("ok");
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const token = url.searchParams.get("token");
      const session = token ? await verifySessionToken(token, this.env.SESSION_SECRET) : null;
      if (!session) {
        return new Response("unauthorized", { status: 401 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ userId: session.userId, role: session.role } satisfies SocketIdentity);
      server.send(JSON.stringify({ type: "hello", payload: { message: "connected to The Lens live feed" } }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  private readIdentity(ws: WebSocket): SocketIdentity | null {
    try {
      return (ws.deserializeAttachment() as SocketIdentity | undefined) ?? null;
    } catch {
      return null;
    }
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
