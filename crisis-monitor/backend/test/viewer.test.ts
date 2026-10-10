import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireAuth, forgetGate, type AuthedVariables } from "../src/middleware";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";

function envWith(row: Record<string, unknown> | null): Env {
  return {
    SESSION_SECRET: "test-secret",
    DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) },
  } as unknown as Env;
}

function appFor() {
  const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
  app.use("*", requireAuth);
  app.get("/api/x", (c) => c.json({ ok: true }));
  app.post("/api/x", (c) => c.json({ ok: true }));
  app.post("/api/auth/change-password", (c) => c.json({ ok: true }));
  return app;
}

async function call(row: Record<string, unknown> | null, method: string, path: string, iatOffset = 0) {
  forgetGate();
  const env = envWith(row);
  const token = await createSessionToken("u1", "client", env.SESSION_SECRET);
  void iatOffset;
  return appFor().request(path, { method, headers: { Authorization: `Bearer ${token}` } }, env);
}

describe("account gate", () => {
  it("lets a normal client write", async () => {
    expect((await call({ read_only: 0, disabled: 0, tokens_valid_after: 0 }, "POST", "/api/x")).status).toBe(200);
  });
  it("lets a viewer read but not write", async () => {
    expect((await call({ read_only: 1, disabled: 0, tokens_valid_after: 0 }, "GET", "/api/x")).status).toBe(200);
    expect((await call({ read_only: 1, disabled: 0, tokens_valid_after: 0 }, "POST", "/api/x")).status).toBe(403);
  });
  it("lets a viewer change their own password", async () => {
    expect((await call({ read_only: 1, disabled: 0, tokens_valid_after: 0 }, "POST", "/api/auth/change-password")).status).toBe(200);
  });
  it("rejects a disabled login", async () => {
    expect((await call({ read_only: 0, disabled: 1, tokens_valid_after: 0 }, "GET", "/api/x")).status).toBe(403);
  });
  it("rejects sessions older than sign-out-everywhere", async () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    expect((await call({ read_only: 0, disabled: 0, tokens_valid_after: future }, "GET", "/api/x")).status).toBe(401);
  });
  it("rejects a deleted user", async () => {
    expect((await call(null, "GET", "/api/x")).status).toBe(401);
  });
});
