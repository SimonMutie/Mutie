/** A push the way a browser receives it: sent by sendPush, then decrypted with the device's own keys (RFC 8291). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeD1 } from "./fakeD1";
import { getVapid, sendPush, cleanPushDestination, pushMessage } from "../src/lib/webpush";
import type { Env } from "../src/bindings";
import type { Notification } from "../src/lib/notify";

const enc = new TextEncoder();
const b64u = (u: ArrayBuffer | Uint8Array) => Buffer.from(u instanceof Uint8Array ? u : new Uint8Array(u)).toString("base64url");
const concat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]));

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

async function decrypt(body: Uint8Array, clientPriv: CryptoKey, clientPub: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const serverPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const serverKey = await crypto.subtle.importKey("raw", serverPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, clientPriv, 256));
  const ikm = await hkdf(auth, secret, concat(enc.encode("WebPush: info\0"), clientPub, serverPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  const end = plain.lastIndexOf(2);
  return new TextDecoder().decode(plain.slice(0, end));
}

const note: Notification = {
  subject: "[CRITICAL] Escalation alert: Mekelle",
  overview: "Conflict escalation feed: 1 new.",
  sections: [{ heading: "CRITICAL · Mekelle, Ethiopia", changed: "New critical escalation. Shelling reported.", analysis: "", links: [] }],
  links: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("web push", () => {
  it("makes one key pair, keeps it, and sends a message the device can read", async () => {
    const { DB } = fakeD1();
    const env = { DB } as unknown as Env;
    const a = await getVapid(env);
    expect(Buffer.from(a.publicKey, "base64url")).toHaveLength(65);

    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const dest = JSON.stringify({ endpoint: "https://push.example.com/abc", keys: { p256dh: b64u(pub), auth: b64u(auth) } });

    let sent: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => ((sent = { url, init }), new Response(null, { status: 201 })));
    const r = await sendPush(env, cleanPushDestination(dest)!, note);
    expect(r).toEqual({ ok: true });
    expect(sent!.url).toBe("https://push.example.com/abc");
    expect(String((sent!.init.headers as Record<string, string>).authorization ?? (sent!.init.headers as Record<string, string>).Authorization)).toContain(`k=${a.publicKey}`);

    const body = new Uint8Array(sent!.init.body as ArrayBuffer);
    const message = JSON.parse(await decrypt(body, pair.privateKey, pub, auth));
    expect(message).toEqual(pushMessage(note));
    expect(message.body).toContain("Shelling reported");

    // The same key is used next time (a fresh module cache would read it from the database).
    expect((await getVapid(env)).publicKey).toBe(a.publicKey);
  });

  it("says when a device has gone, so it can be dropped", async () => {
    const { DB } = fakeD1();
    vi.stubGlobal("fetch", async () => new Response("gone", { status: 410 }));
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const dest = JSON.stringify({ endpoint: "https://push.example.com/x", keys: { p256dh: b64u(pub), auth: b64u(new Uint8Array(16)) } });
    const r = await sendPush({ DB } as unknown as Env, dest, note);
    expect(r.ok).toBe(false);
    expect(r.gone).toBe(true);
  });

  it("only accepts a well-formed https device address", () => {
    expect(cleanPushDestination("nope")).toBeNull();
    expect(cleanPushDestination(JSON.stringify({ endpoint: "http://x", keys: { p256dh: "a", auth: "b" } }))).toBeNull();
    expect(cleanPushDestination(JSON.stringify({ endpoint: "https://x/y", keys: { p256dh: "a", auth: "b" } }))).not.toBeNull();
  });
});
