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
  const png = "data:image/png;base64," + "QUJD".repeat(60_000); // larger than one stored row

  it("refuses non-admins", async () => {
    const res = await call("/", "POST", viewer, { title: "T", kicker: "K", png });
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it("publishes a visual that reads back exactly through its public link", async () => {
    const res = await call("/", "POST", admin, { title: "Road to the vote", kicker: "Calendar", png });
    expect(res.status).toBe(200);
    const { token, path } = (await res.json()) as { token: string; path: string };
    expect(path).toBe(`/visual/${token}`);
    const got = await publicGet(token);
    expect(got.status).toBe(200);
    const body = (await got.json()) as { title: string; kicker: string; png: string };
    expect(body.title).toBe("Road to the vote");
    expect(body.kicker).toBe("Calendar");
    expect(body.png).toBe(png);
  });

  it("stops working once revoked", async () => {
    const { token } = (await (await call("/", "POST", admin, { title: "Gone", kicker: "", png: "data:image/png;base64,QUJD" })).json()) as { token: string };
    expect((await call(`/${token}`, "DELETE", admin)).status).toBe(200);
    expect((await publicGet(token)).status).toBe(404);
  });

  it("rejects something that is not a PNG", async () => {
    const res = await call("/", "POST", admin, { title: "x", kicker: "", png: "data:text/plain;base64,QUJD" });
    expect(res.status).toBe(400);
  });
});
