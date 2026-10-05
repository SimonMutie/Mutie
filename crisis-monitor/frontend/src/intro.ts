/**
 * The opening sequence's sound: a spoken welcome and a soft tone.
 *
 * Both are made by the visitor's own browser — the voice with its built-in
 * speech (no recording, no service, nothing to pay for) and the tone with
 * its audio engine. So the voice is whichever English voice the device
 * has, and sounds a little different from one computer to the next.
 *
 * Browsers do not let a page make sound until the visitor has clicked or
 * pressed something on it. When the site is opened cold the welcome may
 * therefore be refused; it is then kept "pending" and spoken at the first
 * natural moment that follows a click — signing in, or the speaker button
 * on the opening screen.
 */

export const WELCOME_HEADING = "Welcome to The Lens";
export const WELCOME_LINE = "We help you turn signals into insights and foresight, for risk anticipation and strategic decision-making.";
const WELCOME_SPOKEN = "Welcome to The Lens, where we help you turn signals into insights and foresight, for risk anticipation and strategic decision making.";

const SOUND_KEY = "lens.intro.sound";
const SHOWN_KEY = "lens.intro.shown";
export const REPLAY_EVENT = "lens:replay-intro";

const read = (store: Storage, key: string): string | null => {
  try {
    return store.getItem(key);
  } catch {
    return null; // storage blocked (private mode, strict settings): behave as if nothing was saved
  }
};
const write = (store: Storage, key: string, value: string) => {
  try {
    store.setItem(key, value);
  } catch {
    /* see read() */
  }
};

export function introSoundEnabled(): boolean {
  return read(localStorage, SOUND_KEY) !== "off";
}
export function setIntroSoundEnabled(on: boolean): void {
  write(localStorage, SOUND_KEY, on ? "on" : "off");
  if (!on) stopWelcome();
}

/** Once per browser tab: opening the site plays it, moving around inside
 *  the site or reloading the same tab does not. */
export function introAlreadyShown(): boolean {
  return read(sessionStorage, SHOWN_KEY) === "1";
}
export function markIntroShown(): void {
  write(sessionStorage, SHOWN_KEY, "1");
}

/** The opening sequence belongs to the site itself, not to a single
 *  publication or dashboard opened from a shared link, and never to a
 *  dashboard shown inside an article. */
export function introAppliesHere(): boolean {
  if (/^\/(shared|spotlight)\//.test(window.location.pathname)) return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

/* ── voice ─────────────────────────────────────────────────────────── */

let welcomePending = false;
let welcomeSpoken = false;

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  if (english.length === 0) return null;
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural/i.test(v.name) ? 8 : 0) + // the newer, more human voices some browsers offer
    (/^en[-_](GB|KE|ZA|NG|AU|IE)/i.test(v.lang) ? 4 : 0) +
    (/google uk english|sonia|libby|serena|kate|daniel/i.test(v.name) ? 2 : 0) +
    (v.localService ? 0 : 1);
  return [...english].sort((a, b) => score(b) - score(a))[0];
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  // Most browsers fill the list a moment after the page loads.
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 500);
  });
}

export type SpeakResult = "spoken" | "blocked" | "off";

/** Speaks the welcome. "blocked" means the browser refused because the
 *  visitor has not interacted with the page yet (it is then pending). */
export async function speakWelcome(): Promise<SpeakResult> {
  if (!introSoundEnabled() || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return "off";
  const synth = window.speechSynthesis;
  const voice = pickVoice(await loadVoices());
  return new Promise<SpeakResult>((resolve) => {
    let settled = false;
    const finish = (result: SpeakResult) => {
      if (settled) return;
      settled = true;
      welcomePending = result === "blocked";
      if (result === "spoken") welcomeSpoken = true;
      resolve(result);
    };
    const u = new SpeechSynthesisUtterance(WELCOME_SPOKEN);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-GB";
    u.rate = 0.96;
    u.pitch = 1;
    u.volume = 0.9;
    u.onstart = () => finish("spoken");
    u.onerror = () => finish("blocked");
    synth.cancel();
    synth.speak(u);
    // Some browsers neither start nor report an error when they refuse.
    setTimeout(() => finish(synth.speaking ? "spoken" : "blocked"), 1500);
  });
}

/** Called right after something the visitor did (signing in): if the
 *  welcome was refused earlier, it can be spoken now. */
export function speakWelcomeIfPending(): void {
  if (welcomePending && !welcomeSpoken) void speakWelcome();
}

export function stopWelcome(): void {
  welcomePending = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

/* ── tone ──────────────────────────────────────────────────────────── */

/** A quiet two-note swell as the eye opens. Silently does nothing if the
 *  browser will not start audio yet. */
export function playOpeningTone(): void {
  if (!introSoundEnabled()) return;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const start = () => {
      if (ctx.state !== "running") return void ctx.close();
      const t = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(0.07, t + 0.35);
      master.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      const soften = ctx.createBiquadFilter();
      soften.type = "lowpass";
      soften.frequency.setValueAtTime(900, t);
      soften.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
      master.connect(soften).connect(ctx.destination);
      // A fifth (D and A) that settles upwards: open and calm, not an alarm.
      for (const [from, to, level] of [
        [146.8, 220.0, 1],
        [220.0, 293.7, 0.6],
        [587.3, 587.3, 0.18],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(to, t + 0.9);
        gain.gain.value = level;
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + 1.8);
      }
      setTimeout(() => void ctx.close(), 2200);
    };
    if (ctx.state === "running") start();
    else
      ctx
        .resume()
        .then(start)
        .catch(() => void ctx.close());
    // If resume() never settles (no interaction yet), let the context go.
    setTimeout(() => ctx.state !== "running" && ctx.state !== "closed" && void ctx.close(), 1200);
  } catch {
    /* audio unavailable: the sequence simply plays without it */
  }
}
