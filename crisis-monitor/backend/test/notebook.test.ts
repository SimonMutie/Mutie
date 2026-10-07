import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeD1 } from "./fakeD1";
import { composeNotebook, digestSchema, draftNotebook, getNotebook, resetNotebookTableCheck, restorePrevious, saveNotebook, type Digest } from "../src/lib/notebook";
import type { Env } from "../src/bindings";

const digest: Digest = digestSchema.parse({
  periodLabel: "the last 7 days",
  from: "2026-09-30T00:00:00.000Z",
  to: "2026-10-07T00:00:00.000Z",
  total: 120,
  alerts: [],
  incidents: [],
  stories: [
    { title: "Fighting near Mekelle", url: "https://news.example/mek", outlets: 4, items: 9, place: "Mekelle", first: "2026-10-01T00:00:00Z", last: "2026-10-06T00:00:00Z", sources: ["news.example"] },
    { title: "Aid convoy delayed", url: "javascript:alert(1)", outlets: 2, items: 3, place: null, first: "2026-10-02T00:00:00Z", last: "2026-10-03T00:00:00Z", sources: [] },
  ],
  names: [], rising: [], topics: [], places: [], outlets: [],
});

const model = {
  bottom_line: "Reporting on the Mekelle area intensified through the week and centres on fighting between federal and regional forces.",
  developments: [
    { text: "Fighting was reported on the approaches to Mekelle.", sources: [1, 7] },
    { text: "An aid convoy was delayed at a checkpoint.", sources: [2] },
  ],
  analysis: "The sequence suggests the confrontation is moving from rhetoric to positioning, though most reports repeat a single account of events.",
  watch: ["Whether the convoy is cleared this week", "Movements of federal units near Mekelle"],
  caveats: "Most items are single-outlet claims; tone is read from wording only.",
};

describe("composeNotebook", () => {
  it("builds headings, cited bullets and a Sources list from the stories supplied, dropping invented numbers and non-web links", () => {
    const t = composeNotebook(model, digest.stories, "last 7 days")!;
    expect(t).toMatch(/^## Bottom line \(last 7 days\)/);
    expect(t).toContain("- Fighting was reported on the approaches to Mekelle. [1]");
    expect(t).not.toContain("[7]");
    expect(t).toContain("[1] Fighting near Mekelle (news.example) https://news.example/mek");
    expect(t).toContain("[2] Aid convoy delayed");
    expect(t).not.toContain("javascript:");
    expect(t).toContain("## What to watch");
    expect(t).toContain("## Confidence and gaps");
  });
  it("refuses a draft with nothing usable", () => {
    expect(composeNotebook({ bottom_line: "short", developments: [], analysis: "" }, digest.stories, "x")).toBeNull();
  });
});

describe("notebook storage and drafting", () => {
  let env: Env;
  let db: ReturnType<typeof fakeD1>["db"];
  beforeEach(() => {
    resetNotebookTableCheck();
    const f = fakeD1();
    db = f.db;
    db.exec("CREATE TABLE query_notes (id TEXT, query_id TEXT, day TEXT, body TEXT)");
    db.exec("INSERT INTO query_notes VALUES ('n1','q1','2026-10-02','Convoy delay confirmed by a local contact')");
    env = { DB: f.DB, ANTHROPIC_API_KEY: "k" } as unknown as Env;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.messages[0].content).toContain("Convoy delay confirmed by a local contact");
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_summary", input: model }] }), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const q = { id: "q1", name: "Tigray watch", boolean_query: "Tigray" };

  it("saves edits, refuses a stale save, and keeps the replaced text across a redraft", async () => {
    const first = await saveNotebook(env, "q1", "My own text", null, "Mutua");
    expect(first.ok).toBe(true);
    const stale = await saveNotebook(env, "q1", "Overwrite", "2000-01-01T00:00:00.000Z", "Other");
    expect(stale.ok).toBe(false);

    const drafted = await draftNotebook(env, q, digest, "Mutua");
    expect(drafted.ok).toBe(true);
    const row = (await getNotebook(env, "q1"))!;
    expect(row.source).toBe("ai");
    expect(row.body).toContain("## Key developments");
    expect(row.previous_body).toBe("My own text");

    const edited = await saveNotebook(env, "q1", row.body + "\nMy addition.", row.updated_at, "Mutua");
    expect(edited.ok && edited.row.source).toBe("manual");

    const restored = await restorePrevious(env, "q1", "Mutua");
    expect(restored?.body).toBe("My own text");
  });

  it("is rate limited per query and leaves the text alone when the model fails", async () => {
    await saveNotebook(env, "q1", "Keep me", null, "Mutua");
    vi.stubGlobal("fetch", async () => new Response("down", { status: 500 }));
    const failed = await draftNotebook(env, q, digest, "Mutua");
    expect(failed.ok).toBe(false);
    expect((await getNotebook(env, "q1"))!.body).toBe("Keep me");
    const again = await draftNotebook(env, q, digest, "Mutua");
    expect(!again.ok && again.status).toBe(429);
  });
});
