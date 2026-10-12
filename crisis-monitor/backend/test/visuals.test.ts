import { describe, it, expect, beforeAll } from "vitest";
import { visualsRouter, publicVisualsRouter } from "../src/routes/visuals";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

let env: Env;
let admin: Record<string, string>;
let viewer: Record<string, string>;

const call = (path: string, method: string, headers: Record<string, string>, body?: unknown) =>
  visualsRouter.request(path, { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
const publicGet = (token: string) => publicVisualsRouter.request(`/${token}`, {}, env);

beforeAll(async () => {
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    INSERT INTO users (id) VALUES ('a'), ('b');`);
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}` };
  viewer = { Authorization: `Bearer ${await createSessionToken("b", "viewer", "s")}` };
});

describe("published visuals", () => {
  const html = "<!doctype html><p>Timeline ✓ " + "x".repeat(200_000) + "</p>"; // larger than one stored row
  const gif = "data:image/gif;base64," + "QUJD".repeat(60_000);

  it("refuses non-admins", async () => {
    const res = await call("/", "POST", viewer, { title: "T", kicker: "K", kind: "html", content: html });
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it("publishes a live copy that reads back exactly through its public link", async () => {
    const res = await call("/", "POST", admin, { title: "Road to the vote", kicker: "Calendar", kind: "html", content: html, width: 1100, height: 720 });
    expect(res.status).toBe(200);
    const { token, path } = (await res.json()) as { token: string; path: string };
    expect(path).toBe(`/visual/${token}`);
    const body = (await (await publicGet(token)).json()) as { title: string; kicker: string; kind: string; width: number; height: number; content: string };
    expect(body.title).toBe("Road to the vote");
    expect(body.kicker).toBe("Calendar");
    expect(body.kind).toBe("html");
    expect(body.width).toBe(1100);
    expect(body.height).toBe(720);
    expect(body.content).toBe(html);
  });

  it("publishes a GIF that reads back as the same data URL", async () => {
    const res = await call("/", "POST", admin, { title: "Animated", kicker: "", kind: "gif", content: gif });
    const { token } = (await res.json()) as { token: string };
    const body = (await (await publicGet(token)).json()) as { kind: string; content: string };
    expect(body.kind).toBe("gif");
    expect(body.content).toBe(gif);
  });

  it("stops working once revoked", async () => {
    const { token } = (await (await call("/", "POST", admin, { title: "Gone", kicker: "", kind: "html", content: "<p>x</p>" })).json()) as { token: string };
    expect((await call(`/${token}`, "DELETE", admin)).status).toBe(200);
    expect((await publicGet(token)).status).toBe(404);
  });

  it("rejects a GIF that is not a GIF", async () => {
    const res = await call("/", "POST", admin, { title: "x", kicker: "", kind: "gif", content: "data:image/png;base64,QUJD" });
    expect(res.status).toBe(400);
  });
});
