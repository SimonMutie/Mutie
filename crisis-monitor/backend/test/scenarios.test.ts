import { describe, expect, it } from "vitest";
import { liveLayersRouter } from "../src/routes/liveLayers";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("scenarios", () => {
  it("lets admins add, edit and delete numbered scenarios that everyone can read", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('a', 'admin'), ('v', 'viewer');`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const h = async (id: string, role: "admin" | "client") => ({ Authorization: `Bearer ${await createSessionToken(id, role, "s")}`, "Content-Type": "application/json" });
    const admin = await h("a", "admin");
    const viewer = await h("v", "client");
    const body = { question: "Will Al-Shabaab take Mogadishu's outskirts in 2027?", lat: 2.04, lng: 45.34, likelihood: "realistic-possibility", horizon: "By end-2027", indicators: ["AMISOM drawdown", "Fall of Afgooye"] };
    expect((await liveLayersRouter.request("/scenarios", { method: "POST", headers: viewer, body: JSON.stringify(body) }, env)).status).toBe(403);
    const one = (await (await liveLayersRouter.request("/scenarios", { method: "POST", headers: admin, body: JSON.stringify(body) }, env)).json()) as { scenario: { id: string; num: number; indicators: string[] } };
    expect(one.scenario).toMatchObject({ num: 1, indicators: ["AMISOM drawdown", "Fall of Afgooye"] });
    const two = (await (await liveLayersRouter.request("/scenarios", { method: "POST", headers: admin, body: JSON.stringify({ ...body, question: "Will the SAF retake El Fasher?" }) }, env)).json()) as { scenario: { num: number } };
    expect(two.scenario.num).toBe(2);
    expect((await liveLayersRouter.request("/scenarios", { method: "POST", headers: admin, body: JSON.stringify({ ...body, likelihood: "maybe" }) }, env)).status).toBe(400);
    expect((await liveLayersRouter.request(`/scenarios/${one.scenario.id}`, { method: "PUT", headers: admin, body: JSON.stringify({ ...body, likelihood: "likely" }) }, env)).status).toBe(200);
    const list = (await (await liveLayersRouter.request("/scenarios", { headers: viewer }, env)).json()) as { scenarios: { id: string; likelihood: string }[] };
    expect(list.scenarios).toHaveLength(2);
    expect(list.scenarios[0].likelihood).toBe("likely");
    expect((await liveLayersRouter.request(`/scenarios/${one.scenario.id}`, { method: "DELETE", headers: admin }, env)).status).toBe(200);
    expect((await liveLayersRouter.request(`/scenarios/${one.scenario.id}`, { method: "DELETE", headers: admin }, env)).status).toBe(404);
  });
});
